package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
)

// The Board Room account's refresh token is a long-lived credential that can
// read and write that calendar. The KV store is plain Postgres and gets backed
// up, so the token is encrypted at rest with a key that lives in the plugin
// config rather than in the database.

var errNoEncryptionKey = errors.New("no encryption key is configured")

func newGCM(key string) (cipher.AEAD, error) {
	if key == "" {
		return nil, errNoEncryptionKey
	}
	block, err := aes.NewCipher([]byte(key))
	if err != nil {
		return nil, fmt.Errorf("the encryption key is unusable: %w", err)
	}
	return cipher.NewGCM(block)
}

func encryptString(key, plaintext string) (string, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("could not generate a nonce: %w", err)
	}

	// The nonce is prepended to the ciphertext so decryption is self-contained.
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func decryptString(key, encoded string) (string, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}

	sealed, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("the stored token is not valid base64: %w", err)
	}
	if len(sealed) < gcm.NonceSize() {
		return "", errors.New("the stored token is too short to be valid")
	}

	nonce, ciphertext := sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		// Usually means the encryption key changed after the token was stored.
		return "", fmt.Errorf("the stored token could not be decrypted; reconnect the Board Room account: %w", err)
	}
	return string(plaintext), nil
}
