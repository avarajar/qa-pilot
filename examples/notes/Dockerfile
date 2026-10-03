FROM node:22-alpine
WORKDIR /app
# solo la dependencia de runtime; las de test viven en el workspace del repo
RUN npm init -y >/dev/null && npm install --no-audit --no-fund express@^5.1.0
COPY auth.js server.js ./
RUN npm pkg set type=module
ENV PORT=3100
EXPOSE 3100
CMD ["node", "server.js"]
