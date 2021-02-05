# Build UI
FROM node:latest as frontend
WORKDIR /build
COPY . .
RUN cd frontend && npm install && npm run build

# Build Backend
FROM golang:latest as backend
WORKDIR /build
COPY backend/ .
RUN go build -o horse-poo -ldflags="-w -s" 

FROM debian:stable-slim

# Enable setting custom uids for odoo user during build of scaffolds
ARG UID=1000
ARG GID=1000

RUN groupadd -g $GID odoo -o \
    && useradd -l -md /app -s /bin/false -u $UID -g $GID hp \
    && sync

EXPOSE 3000

USER hp

WORKDIR /app
RUN mkdir -p public && mkdir -p data

COPY --from=frontend /build/backend/public/ public/
COPY --from=backend /build/horse-poo .

CMD [ "./horse-poo" ]
