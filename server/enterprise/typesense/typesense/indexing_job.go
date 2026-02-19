// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.enterprise for license information.

package typesense

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/app"
	"github.com/mattermost/mattermost/server/v8/channels/jobs"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

const (
	timeBetweenBatches = 100 * time.Millisecond
)

type TypesenseIndexerInterfaceImpl struct {
	Server *app.Server
}

type IndexingProgress struct {
	Now            time.Time
	StartAtTime    int64
	EndAtTime      int64
	LastEntityTime int64

	TotalPostsCount int64
	DonePostsCount  int64
	DonePosts       bool
	LastPostID      string

	TotalFilesCount int64
	DoneFilesCount  int64
	DoneFiles       bool
	LastFileID      string

	TotalChannelsCount int64
	DoneChannelsCount  int64
	DoneChannels       bool
	LastChannelID      string

	TotalUsersCount int64
	DoneUsersCount  int64
	DoneUsers       bool
	LastUserID      string
}

func (ip *IndexingProgress) CurrentProgress() int64 {
	current := ip.DonePostsCount + ip.DoneChannelsCount + ip.DoneUsersCount + ip.DoneFilesCount
	total := ip.TotalPostsCount + ip.TotalChannelsCount + ip.TotalFilesCount + ip.TotalUsersCount
	if total == 0 {
		return 0
	}
	return current * 100 / total
}

func (ip *IndexingProgress) IsDone(job *model.Job) bool {
	donePosts := job.Data["index_posts"] == "false" || ip.DonePosts
	doneChannels := job.Data["index_channels"] == "false" || ip.DoneChannels
	doneUsers := job.Data["index_users"] == "false" || ip.DoneUsers
	doneFiles := job.Data["index_files"] == "false" || ip.DoneFiles

	return donePosts && doneChannels && doneUsers && doneFiles
}

type IndexerWorker struct {
	name    string
	stateMut sync.Mutex
	stopCh   chan struct{}
	stopped  bool
	stoppedCh chan bool
	jobs     chan model.Job
	jobServer *jobs.JobServer
	logger   mlog.LoggerIFace
	typesense *TypesenseInterfaceImpl
	license func() *model.License
}

func NewIndexerWorker(name string, jobServer *jobs.JobServer, logger mlog.LoggerIFace, typesense *TypesenseInterfaceImpl, licenseFn func() *model.License) *IndexerWorker {
	return &IndexerWorker{
		name:      name,
		stoppedCh: make(chan bool, 1),
		jobs:      make(chan model.Job),
		jobServer: jobServer,
		logger:    logger,
		typesense: typesense,
		stopped:   true,
		license:   licenseFn,
	}
}

func (tsi *TypesenseIndexerInterfaceImpl) MakeWorker() model.Worker {
	const workerName = "EnterpriseTypesenseIndexer"

	logger := tsi.Server.Jobs.Logger().With(mlog.String("worker_name", workerName))

	if tsi.Server.Platform().SearchEngine.TypesenseEngine == nil {
		logger.Error("Worker: Typesense engine is not initialized")
		return nil
	}

	typesenseImpl, ok := tsi.Server.Platform().SearchEngine.TypesenseEngine.(*TypesenseInterfaceImpl)
	if !ok {
		logger.Error("Worker: Failed to cast to TypesenseInterfaceImpl")
		return nil
	}

	return NewIndexerWorker(workerName, tsi.Server.Jobs, logger, typesenseImpl, tsi.Server.License)
}

func (worker *IndexerWorker) Run() {
	worker.stateMut.Lock()
	if worker.stopped {
		worker.stopped = false
		worker.stopCh = make(chan struct{})
	} else {
		worker.stateMut.Unlock()
		return
	}
	worker.stateMut.Unlock()

	worker.logger.Debug("Worker Started")

	defer func() {
		worker.logger.Debug("Worker: Finished")
		worker.stoppedCh <- true
	}()

	for {
		select {
		case <-worker.stopCh:
			worker.logger.Debug("Worker: Received stop signal")
			return
		case job := <-worker.jobs:
			worker.DoJob(&job)
		}
	}
}

func (worker *IndexerWorker) Stop() {
	worker.stateMut.Lock()
	defer worker.stateMut.Unlock()

	if worker.stopped {
		return
	}
	worker.stopped = true

	worker.logger.Debug("Worker Stopping")
	close(worker.stopCh)
	<-worker.stoppedCh
}

func (worker *IndexerWorker) JobChannel() chan<- model.Job {
	return worker.jobs
}

func (worker *IndexerWorker) IsEnabled(cfg *model.Config) bool {
	if *cfg.TypesenseSettings.EnableIndexing {
		return true
	}

	return false
}

func (worker *IndexerWorker) initEntitiesToIndex(job *model.Job) {
	if job.Data == nil {
		job.Data = model.StringMap{}
	}

	indexPostsRaw, ok := job.Data["index_posts"]
	job.Data["index_posts"] = strconv.FormatBool(!ok || indexPostsRaw == "true")

	indexChannelsRaw, ok := job.Data["index_channels"]
	job.Data["index_channels"] = strconv.FormatBool(!ok || indexChannelsRaw == "true")

	indexUsersRaw, ok := job.Data["index_users"]
	job.Data["index_users"] = strconv.FormatBool(!ok || indexUsersRaw == "true")

	indexFilesRaw, ok := job.Data["index_files"]
	job.Data["index_files"] = strconv.FormatBool(!ok || indexFilesRaw == "true")
}

func initProgress(logger mlog.LoggerIFace, jobServer *jobs.JobServer, job *model.Job, store store.Store) (IndexingProgress, error) {
	now := time.Now()
	progress := IndexingProgress{
		Now: now,
	}

	// Get stored progress if available
	if val, ok := job.Data["start_time"]; ok {
		startTime, _ := strconv.ParseInt(val, 10, 64)
		progress.LastEntityTime = startTime
	}

	if val, ok := job.Data["original_start_time"]; ok {
		startAtTime, _ := strconv.ParseInt(val, 10, 64)
		progress.StartAtTime = startAtTime
	} else {
		progress.StartAtTime = model.GetMillisForTime(now.AddDate(0, 0, -14))
		progress.LastEntityTime = progress.StartAtTime
	}

	if val, ok := job.Data["end_time"]; ok {
		endAtTime, _ := strconv.ParseInt(val, 10, 64)
		progress.EndAtTime = endAtTime
	} else {
		progress.EndAtTime = model.GetMillis()
	}

	// Get counts
	if val, ok := job.Data["done_posts_count"]; ok {
		progress.DonePostsCount, _ = strconv.ParseInt(val, 10, 64)
	}
	if val, ok := job.Data["done_channels_count"]; ok {
		progress.DoneChannelsCount, _ = strconv.ParseInt(val, 10, 64)
	}
	if val, ok := job.Data["done_users_count"]; ok {
		progress.DoneUsersCount, _ = strconv.ParseInt(val, 10, 64)
	}
	if val, ok := job.Data["done_files_count"]; ok {
		progress.DoneFilesCount, _ = strconv.ParseInt(val, 10, 64)
	}

	// Get last IDs
	if val, ok := job.Data["start_post_id"]; ok {
		progress.LastPostID = val
	}
	if val, ok := job.Data["start_channel_id"]; ok {
		progress.LastChannelID = val
	}
	if val, ok := job.Data["start_user_id"]; ok {
		progress.LastUserID = val
	}
	if val, ok := job.Data["start_file_id"]; ok {
		progress.LastFileID = val
	}

	// Estimate totals
	if job.Data["index_posts"] != "false" {
		count, err := store.Post().AnalyticsPostCount(&model.PostCountOptions{SinceUpdateAt: progress.StartAtTime, UntilUpdateAt: progress.EndAtTime})
		if err != nil {
			logger.Warn("Failed to get post count", mlog.Err(err))
			progress.TotalPostsCount = 10000000
		} else {
			progress.TotalPostsCount = count
		}
	}

	if job.Data["index_channels"] != "false" {
		count, err := store.Channel().AnalyticsTypeCount("", "O")
		if err != nil {
			logger.Warn("Failed to get channel count", mlog.Err(err))
			progress.TotalChannelsCount = 100000
		} else {
			progress.TotalChannelsCount = count
		}
	}

	if job.Data["index_users"] != "false" {
		count, err := store.User().Count(model.UserCountOptions{})
		if err != nil {
			logger.Warn("Failed to get user count", mlog.Err(err))
			progress.TotalUsersCount = 10000
		} else {
			progress.TotalUsersCount = count
		}
	}

	if job.Data["index_files"] != "false" {
		// Estimate file count
		progress.TotalFilesCount = 100000
	}

	return progress, nil
}

func (worker *IndexerWorker) DoJob(job *model.Job) {
	logger := worker.logger.With(jobs.JobLoggerFields(job)...)
	logger.Debug("Worker: Received a new candidate job.")
	defer worker.jobServer.HandleJobPanic(logger, job)

	var appErr *model.AppError
	job, appErr = worker.jobServer.ClaimJob(job)
	if appErr != nil {
		logger.Warn("Worker: Error occurred while trying to claim job", mlog.Err(appErr))
		return
	} else if job == nil {
		return
	}

	logger.Info("Worker: Indexing job claimed by worker")

	worker.initEntitiesToIndex(job)
	progress, err := initProgress(logger, worker.jobServer, job, worker.jobServer.Store)
	if err != nil {
		logger.Error("Worker: Failed to initialize progress", mlog.Err(err))
		return
	}

	var cancelContext request.CTX = request.EmptyContext(worker.logger)
	cancelCtx, cancelCancelWatcher := context.WithCancel(context.Background())
	cancelWatcherChan := make(chan struct{}, 1)
	cancelContext = cancelContext.WithContext(cancelCtx)
	go worker.jobServer.CancellationWatcher(cancelContext, job.Id, cancelWatcherChan)

	defer cancelCancelWatcher()

	for {
		select {
		case <-cancelWatcherChan:
			logger.Info("Worker: Indexing job has been canceled via CancellationWatcher")
			if err := worker.jobServer.SetJobCanceled(job); err != nil {
				logger.Error("Worker: Failed to mark job as cancelled", mlog.Err(err))
			}
			return

		case <-worker.stopCh:
			logger.Info("Worker: Indexing has been canceled via Worker Stop. Setting the job back to pending.")
			if err := worker.jobServer.SetJobPending(job); err != nil {
				logger.Error("Worker: Failed to mark job as canceled", mlog.Err(err))
			}
			return

		case <-time.After(timeBetweenBatches):
			var err *model.AppError
			if progress, err = worker.IndexBatch(logger, progress, job); err != nil {
				logger.Error("Worker: Failed to index batch for job", mlog.Err(err))
				if err2 := worker.jobServer.SetJobError(job, err); err2 != nil {
					logger.Error("Worker: Failed to set job error", mlog.Err(err2), mlog.NamedErr("set_error", err))
				}
				return
			}

			// Store progress
			if job.Data == nil {
				job.Data = make(model.StringMap)
			}

			job.Data["done_posts_count"] = strconv.FormatInt(progress.DonePostsCount, 10)
			job.Data["done_channels_count"] = strconv.FormatInt(progress.DoneChannelsCount, 10)
			job.Data["done_users_count"] = strconv.FormatInt(progress.DoneUsersCount, 10)
			job.Data["done_files_count"] = strconv.FormatInt(progress.DoneFilesCount, 10)

			job.Data["start_time"] = strconv.FormatInt(progress.LastEntityTime, 10)
			job.Data["start_post_id"] = progress.LastPostID
			job.Data["start_channel_id"] = progress.LastChannelID
			job.Data["start_user_id"] = progress.LastUserID
			job.Data["start_file_id"] = progress.LastFileID
			job.Data["original_start_time"] = strconv.FormatInt(progress.StartAtTime, 10)
			job.Data["end_time"] = strconv.FormatInt(progress.EndAtTime, 10)

			if err := worker.jobServer.SetJobProgress(job, progress.CurrentProgress()); err != nil {
				logger.Error("Worker: Failed to set progress for job", mlog.Err(err))
				if err2 := worker.jobServer.SetJobError(job, err); err2 != nil {
					logger.Error("Worker: Failed to set error for job", mlog.Err(err2), mlog.NamedErr("set_error", err))
				}
				return
			}

			if progress.IsDone(job) {
				if err := worker.jobServer.SetJobSuccess(job); err != nil {
					logger.Error("Worker: Failed to set success for job", mlog.Err(err))
					if err2 := worker.jobServer.SetJobError(job, err); err2 != nil {
						logger.Error("Worker: Failed to set error for job", mlog.Err(err2), mlog.NamedErr("set_error", err))
					}
				}
				logger.Info("Worker: Indexing job finished successfully")
				return
			}
		}
	}
}

func (worker *IndexerWorker) IndexBatch(logger mlog.LoggerIFace, progress IndexingProgress, job *model.Job) (IndexingProgress, *model.AppError) {
	if job.Data["index_posts"] != "false" && !progress.DonePosts {
		worker.logger.Debug("Worker: indexing post batch...")
		return worker.IndexPostsBatch(logger, progress)
	}

	if job.Data["index_channels"] != "false" && !progress.DoneChannels {
		worker.logger.Debug("Worker: indexing channels batch...")
		return worker.IndexChannelsBatch(logger, progress)
	}

	if job.Data["index_users"] != "false" && !progress.DoneUsers {
		worker.logger.Debug("Worker: indexing users batch...")
		return worker.IndexUsersBatch(logger, progress)
	}

	if job.Data["index_files"] != "false" && !progress.DoneFiles {
		worker.logger.Debug("Worker: indexing files batch...")
		return worker.IndexFilesBatch(logger, progress)
	}

	return progress, model.NewAppError("IndexerWorker", "ent.typesense.indexer.index_batch.nothing_left_to_index.error", nil, "", http.StatusInternalServerError)
}

func (worker *IndexerWorker) IndexPostsBatch(logger mlog.LoggerIFace, progress IndexingProgress) (IndexingProgress, *model.AppError) {
	batchSize := *worker.jobServer.Config().TypesenseSettings.BatchSize
	posts, err := worker.jobServer.Store.Post().GetPostsBatchForIndexing(progress.LastEntityTime, progress.LastPostID, batchSize)
	if err != nil {
		return progress, model.NewAppError("IndexPostsBatch", "ent.typesense.post.get_posts_batch_for_indexing.error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	if len(posts) == 0 {
		progress.DonePosts = true
		progress.LastEntityTime = progress.StartAtTime
		return progress, nil
	}

	if appErr := worker.typesense.SyncBulkIndexPosts(posts); appErr != nil {
		return progress, appErr
	}

	lastPost := &posts[len(posts)-1].Post

	if progress.EndAtTime <= lastPost.CreateAt {
		progress.DonePosts = true
		progress.LastEntityTime = progress.StartAtTime
	} else {
		progress.LastEntityTime = lastPost.CreateAt
	}

	progress.LastPostID = lastPost.Id
	progress.DonePostsCount += int64(len(posts))

	return progress, nil
}

func (worker *IndexerWorker) IndexChannelsBatch(logger mlog.LoggerIFace, progress IndexingProgress) (IndexingProgress, *model.AppError) {
	batchSize := *worker.jobServer.Config().TypesenseSettings.BatchSize
	channels, err := worker.jobServer.Store.Channel().GetChannelsBatchForIndexing(progress.LastEntityTime, progress.LastChannelID, batchSize)
	if err != nil {
		return progress, model.NewAppError("IndexChannelsBatch", "ent.typesense.channel.get_channels_batch_for_indexing.error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	if len(channels) == 0 {
		progress.DoneChannels = true
		progress.LastEntityTime = progress.StartAtTime
		return progress, nil
	}

	if appErr := worker.typesense.SyncBulkIndexChannels(request.EmptyContext(logger), channels, nil, []string{}); appErr != nil {
		return progress, appErr
	}

	lastChannel := channels[len(channels)-1]

	if progress.EndAtTime <= lastChannel.CreateAt {
		progress.DoneChannels = true
		progress.LastEntityTime = progress.StartAtTime
	} else {
		progress.LastEntityTime = lastChannel.CreateAt
	}

	progress.LastChannelID = lastChannel.Id
	progress.DoneChannelsCount += int64(len(channels))

	return progress, nil
}

func (worker *IndexerWorker) IndexUsersBatch(logger mlog.LoggerIFace, progress IndexingProgress) (IndexingProgress, *model.AppError) {
	batchSize := *worker.jobServer.Config().TypesenseSettings.BatchSize
	users, err := worker.jobServer.Store.User().GetUsersBatchForIndexing(progress.LastEntityTime, progress.LastUserID, batchSize)
	if err != nil {
		return progress, model.NewAppError("IndexUsersBatch", "ent.typesense.user.get_users_batch_for_indexing.error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	if len(users) == 0 {
		progress.DoneUsers = true
		progress.LastEntityTime = progress.StartAtTime
		return progress, nil
	}

	if appErr := worker.typesense.SyncBulkIndexUsers(users); appErr != nil {
		return progress, appErr
	}

	lastUser := users[len(users)-1]

	if progress.EndAtTime <= lastUser.CreateAt {
		progress.DoneUsers = true
		progress.LastEntityTime = progress.StartAtTime
	} else {
		progress.LastEntityTime = lastUser.CreateAt
	}

	progress.LastUserID = lastUser.Id
	progress.DoneUsersCount += int64(len(users))

	return progress, nil
}

func (worker *IndexerWorker) IndexFilesBatch(logger mlog.LoggerIFace, progress IndexingProgress) (IndexingProgress, *model.AppError) {
	batchSize := *worker.jobServer.Config().TypesenseSettings.BatchSize
	files, err := worker.jobServer.Store.FileInfo().GetFilesBatchForIndexing(progress.LastEntityTime, progress.LastFileID, true, batchSize)
	if err != nil {
		return progress, model.NewAppError("IndexFilesBatch", "ent.typesense.file.get_files_batch_for_indexing.error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	if len(files) == 0 {
		progress.DoneFiles = true
		progress.LastEntityTime = progress.StartAtTime
		return progress, nil
	}

	if appErr := worker.typesense.SyncBulkIndexFiles(files); appErr != nil {
		return progress, appErr
	}

	lastFile := &files[len(files)-1].FileInfo

	if progress.EndAtTime <= lastFile.CreateAt {
		progress.DoneFiles = true
		progress.LastEntityTime = progress.StartAtTime
	} else {
		progress.LastEntityTime = lastFile.CreateAt
	}

	progress.LastFileID = lastFile.Id
	progress.DoneFilesCount += int64(len(files))

	return progress, nil
}
