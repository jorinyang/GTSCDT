FROM node:20-alpine
RUN apk add --no-cache poppler-utils
WORKDIR /app
COPY templates/ /app/
ENV PORT=8899
EXPOSE 8899
CMD ["node","server.mjs"]
