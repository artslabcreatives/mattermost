package main

import (
	"strings"
	"testing"
)

const testKey = "0123456789abcdef0123456789abcdef" // 32 bytes -> AES-256

func TestEncryptRoundTrip(t *testing.T) {
	plaintext := `{"access_token":"ya29.secret","refresh_token":"1//refresh"}`

	sealed, err := encryptString(testKey, plaintext)
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}
	if strings.Contains(sealed, "refresh") || strings.Contains(sealed, "ya29") {
		t.Fatal("the token leaked into the ciphertext")
	}

	got, err := decryptString(testKey, sealed)
	if err != nil {
		t.Fatalf("decrypt failed: %v", err)
	}
	if got != plaintext {
		t.Fatalf("round trip changed the token")
	}
}

// GCM must use a fresh nonce each time, or identical tokens would be
// distinguishable in the database.
func TestEncryptIsNotDeterministic(t *testing.T) {
	a, err := encryptString(testKey, "same input")
	if err != nil {
		t.Fatal(err)
	}
	b, err := encryptString(testKey, "same input")
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("encrypting twice produced identical ciphertext; the nonce is being reused")
	}
}

// A rotated key must fail loudly rather than return junk.
func TestDecryptWithWrongKeyFails(t *testing.T) {
	sealed, err := encryptString(testKey, "secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decryptString("fedcba9876543210fedcba9876543210", sealed); err == nil {
		t.Fatal("decrypting with the wrong key must fail")
	}
}

func TestDecryptRejectsTamperedCiphertext(t *testing.T) {
	sealed, err := encryptString(testKey, "secret")
	if err != nil {
		t.Fatal(err)
	}
	// Flip a character in the middle of the payload.
	tampered := []byte(sealed)
	mid := len(tampered) / 2
	if tampered[mid] == 'A' {
		tampered[mid] = 'B'
	} else {
		tampered[mid] = 'A'
	}
	if _, err := decryptString(testKey, string(tampered)); err == nil {
		t.Fatal("tampered ciphertext must not decrypt")
	}
}

func TestEncryptRequiresKey(t *testing.T) {
	if _, err := encryptString("", "secret"); err == nil {
		t.Fatal("encrypting without a key must fail rather than store plaintext")
	}
}

func TestEncryptRejectsBadKeyLength(t *testing.T) {
	if _, err := encryptString("tooshort", "secret"); err == nil {
		t.Fatal("a key that isn't a valid AES length must be rejected")
	}
}
