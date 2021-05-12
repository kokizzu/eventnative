package adapters

import "io"

//Stage is an intermediate layer (for BQ, Snowflake, Redshift, etc)
type Stage interface {
	io.Closer
	UploadBytes(fileName string, fileBytes []byte) error
	ListBucket(prefix string) ([]string, error)
	GetObject(name string) ([]byte, error)
	DeleteObject(key string) error
}
