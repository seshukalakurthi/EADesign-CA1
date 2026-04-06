FROM node:20-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY server.js .
USER app
EXPOSE 3001
CMD ["node", "server.js"]