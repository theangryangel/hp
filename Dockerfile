# Build UI
FROM node:latest as frontend
WORKDIR /build
COPY . .
RUN cd frontend && npm install npm run build

# Build Backend
FROM golang:latest as backend
WORKDIR /build
COPY backend/ .
RUN go build -o horse-poo -ldflags="-w -s" 

FROM debian:stable-slim

EXPOSE 3000

WORKDIR /app
RUN mkdir -p public && mkdir -p data

COPY --from=frontend /build/backend/public/ public/
COPY --from=backend /build/horse-poo .

CMD [ "./horse-poo" ]
