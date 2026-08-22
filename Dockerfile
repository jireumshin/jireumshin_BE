# ---------- build stage ----------
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

COPY . .
RUN yarn prisma generate
RUN yarn build

# ---------- production stage ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
# 런타임 의존성만 설치 (devDeps 제외로 이미지 대폭 축소). prisma CLI는 deps로 옮겨 migrate 유지.
RUN yarn plugin import workspace-tools && yarn workspaces focus --production

COPY prisma ./prisma
RUN yarn prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 4000
# 컨테이너 시작 시 마이그레이션 적용 후 서버 기동 (프로덕션은 RDS로 migrate deploy)
CMD ["sh", "-c", "yarn prisma migrate deploy && node dist/main"]
