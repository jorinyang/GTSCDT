FROM node:20-alpine
WORKDIR /app
COPY templates/ /app/
ENV PORT=8899
EXPOSE 8899
CMD ["node","server.mjs"]
