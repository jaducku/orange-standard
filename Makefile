BINARY := bin/orange-standard
PKG := ./...

.PHONY: all build run test vet fmt tidy clean

all: vet test build

build:
	go build -o $(BINARY) ./cmd/orange-standard

run:
	go run ./cmd/orange-standard

test:
	go test $(PKG)

vet:
	go vet $(PKG)

fmt:
	gofmt -w .

tidy:
	go mod tidy

clean:
	rm -rf bin
