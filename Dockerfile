FROM golang:1.26-alpine AS build
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY api ./api
RUN CGO_ENABLED=0 go build -o /manga-api ./api

FROM alpine:3.22
RUN apk add --no-cache chromium nss freetype harfbuzz ttf-freefont
ENV CHROME_PATH=/usr/bin/chromium
ENV PORT=8080
EXPOSE 8080
COPY --from=build /manga-api /manga-api
ENTRYPOINT ["/manga-api"]
