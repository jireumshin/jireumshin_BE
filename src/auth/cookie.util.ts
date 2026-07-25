import type { CookieOptions } from "express";

export const ACCESS_TOKEN_COOKIE = "access_token";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 환경별 쿠키 옵션.
 * - 프로덕션: 크로스 서브도메인(www ↔ api) → secure + SameSite=None + domain=.jireumshin.shop
 * - 개발: http·localhost → secure 불가, SameSite=Lax, domain 없음
 */
export function accessTokenCookieOptions(): CookieOptions {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: "/",
    maxAge: SEVEN_DAYS_MS,
  };
}

/** 쿠키 삭제 시 maxAge를 뺀 동일 옵션을 써야 브라우저가 매칭해 제거함 */
export function clearCookieOptions(): CookieOptions {
  const { maxAge: _maxAge, ...rest } = accessTokenCookieOptions();
  return rest;
}

export const OAUTH_STATE_COOKIE = "kakao_oauth_state";
const TEN_MINUTES_MS = 10 * 60 * 1000;

export function oauthStateCookieOptions(): CookieOptions {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    domain: process.env.COOKIE_DOMAIN || undefined,
    path: "/",
    maxAge: TEN_MINUTES_MS,
  };
}

export function clearOauthStateCookieOptions(): CookieOptions {
  const { maxAge: _maxAge, ...rest } = oauthStateCookieOptions();
  return rest;
}
