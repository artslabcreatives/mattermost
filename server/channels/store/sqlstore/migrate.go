// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package sqlstore

import (
	"cmp"
	"context"
	"fmt"
	"io"
	"log"
	"path"
	"slices"
	"strconv"
	"sync"

	"github.com/mattermost/morph"
	ps "github.com/mattermost/morph/drivers/postgres"
	"github.com/mattermost/morph/models"
	mbindata "github.com/mattermost/morph/sources/embedded"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/v8/channels/db"
)

type Migrator struct {
	engine *morph.Morph
	store  *SqlStore
}

func NewMigrator(settings model.SqlSettings, logger mlog.LoggerIFace, dryRun bool) (*Migrator, error) {
	ss := &SqlStore{
		rrCounter:   0,
		srCounter:   0,
		settings:    &settings,
		logger:      logger,
		quitMonitor: make(chan struct{}),
		wgMonitor:   &sync.WaitGroup{},
	}

	err := ss.initConnection()
	if err != nil {
		return nil, fmt.Errorf("error in initializing connection: %w", err)
	}

	ver, err := ss.GetDbVersion(true)
	if err != nil {
		return nil, fmt.Errorf("error while getting DB version: %w", err)
	}

	if err = ss.checkVersion(ver); err != nil {
		return nil, fmt.Errorf("error while checking DB version: %w", err)
	}

	engine, err := ss.initMorph(dryRun, true)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize morph: %w", err)
	}

	return &Migrator{
		engine: engine,
		store:  ss,
	}, nil
}

func (m *Migrator) Close() error {
	if err := m.engine.Close(); err != nil {
		return fmt.Errorf("failed to close morph engine: %w", err)
	}

	m.store.Close()

	return nil
}

func (m *Migrator) GetFileName(plan *models.Plan) (string, error) {
	if len(plan.Migrations) == 0 {
		return "", fmt.Errorf("plan is empty")
	}

	to := plan.Migrations[len(plan.Migrations)-1].Version
	from, err := m.store.GetDBSchemaVersion()
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("migration_plan_%d_%d", from, to), nil
}

// customMigrationRenumbers maps fork-specific migrations that were first shipped
// with versions colliding with upstream (000150/000151 in v12) to their reserved
// 900+ versions. db_migrations uses Version as its primary key, so the old rows
// must be moved before upstream migrations with those versions can be recorded.
var customMigrationRenumbers = []struct {
	name       string
	oldVersion int
	newVersion int
}{
	{name: "fileinfo_ispinned", oldVersion: 150, newVersion: 900},
	{name: "channel_group_icons", oldVersion: 151, newVersion: 901},
}

func (ss *SqlStore) renumberCustomMigrations() error {
	var exists bool
	if err := ss.GetMaster().Get(&exists, "SELECT to_regclass('db_migrations') IS NOT NULL"); err != nil {
		return fmt.Errorf("failed to check for db_migrations table: %w", err)
	}
	if !exists {
		return nil
	}

	for _, m := range customMigrationRenumbers {
		if _, err := ss.GetMaster().Exec("UPDATE db_migrations SET Version = $1 WHERE Version = $2 AND Name = $3", m.newVersion, m.oldVersion, m.name); err != nil {
			return fmt.Errorf("failed to renumber custom migration %s: %w", m.name, err)
		}
	}

	return nil
}

func (ss *SqlStore) initMorph(dryRun, enableLogging bool) (*morph.Morph, error) {
	if !dryRun {
		if err := ss.renumberCustomMigrations(); err != nil {
			return nil, err
		}
	}

	assets := db.Assets()

	assetsList, err := assets.ReadDir(path.Join("migrations", ss.DriverName()))
	if err != nil {
		return nil, err
	}

	assetNamesForDriver := make([]string, len(assetsList))
	for i, entry := range assetsList {
		assetNamesForDriver[i] = entry.Name()
	}

	src, err := mbindata.WithInstance(&mbindata.AssetSource{
		Names: assetNamesForDriver,
		AssetFunc: func(name string) ([]byte, error) {
			return assets.ReadFile(path.Join("migrations", ss.DriverName(), name))
		},
	})
	if err != nil {
		return nil, err
	}

	driver, err := ps.WithInstance(ss.GetMaster().DB().DB)
	if err != nil {
		return nil, err
	}

	var logWriter io.Writer
	if enableLogging {
		logWriter = &morphWriter{}
	} else {
		logWriter = io.Discard
	}

	opts := []morph.EngineOption{
		morph.WithLogger(log.New(logWriter, "", log.Lshortfile)),
		morph.WithLock("mm-lock-key"),
		morph.SetStatementTimeoutInSeconds(*ss.settings.MigrationsStatementTimeoutSeconds),
		morph.SetDryRun(dryRun),
	}

	engine, err := morph.New(context.Background(), driver, src, opts...)
	if err != nil {
		return nil, err
	}

	return engine, nil
}

func (ss *SqlStore) migrate(direction migrationDirection, dryRun, enableMorphLogging bool) error {
	engine, err := ss.initMorph(dryRun, enableMorphLogging)
	if err != nil {
		return err
	}
	defer engine.Close()

	switch direction {
	case migrationsDirectionDown:
		_, err = engine.ApplyDown(-1)
		return err
	default:
		return engine.ApplyAll()
	}
}

func (m *Migrator) GeneratePlan(shouldRecover bool) (*models.Plan, error) {
	diff, err := m.engine.Diff(models.Up)
	if err != nil {
		return nil, err
	}

	plan, err := m.engine.GeneratePlan(diff, shouldRecover)
	if err != nil {
		return nil, err
	}

	return plan, nil
}

// MigrateWithPlan migrates the database to the latest version using the provided plan.
func (m *Migrator) MigrateWithPlan(plan *models.Plan, dryRun bool) error {
	return m.engine.ApplyPlan(plan)
}

// PreMigrate runs the pre-migration handlers that normally execute during
// server startup. Callers on the CLI up-migration path (e.g. `mattermost db
// migrate`, used by cloud upgrades) must invoke this before MigrateWithPlan so
// the same fixes apply outside of server startup. Skipped under dryRun because
// preMigration writes directly via GetMaster().Exec and does not participate
// in Morph's dry-run.
// This is intentionally only called for forward migrations and skipped for
// downgrades.
func (m *Migrator) PreMigrate() error {
	return m.store.preMigration()
}

func (m *Migrator) DowngradeMigrations(dryRun bool, versions ...string) error {
	migrations, err := m.engine.Diff(models.Down)
	if err != nil {
		return err
	}

	migrationsToDowngrade := make([]*models.Migration, 0, len(versions))
	for _, version := range versions {
		for _, migration := range migrations {
			versionNumber, sErr := strconv.Atoi(version)
			if sErr != nil {
				return sErr
			}
			if migration.Version == uint32(versionNumber) {
				migrationsToDowngrade = append(migrationsToDowngrade, migration)
			}
		}
	}

	slices.SortFunc(migrationsToDowngrade, func(a, b *models.Migration) int {
		return cmp.Compare(b.Version, a.Version)
	})

	if len(migrationsToDowngrade) != len(versions) {
		mlog.Warn("could not match give migration versions, going to downgrade only the migrations those are available.")
	}

	plan, err := m.engine.GeneratePlan(migrationsToDowngrade, false)
	if err != nil {
		return err
	}

	return m.engine.ApplyPlan(plan)
}
