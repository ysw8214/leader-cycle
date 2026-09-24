export default async function handler(req, res) {
  try {
    const code = String(req.query.code || "").trim();

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        ok: false,
        error: "6자리 종목코드(code)가 필요합니다."
      });
    }

    /* ==========================================
       기존 MARKET HISTORY 호출
    ========================================== */

    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const host = req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    const response = await fetch(
      `${baseUrl}/api/market-history?code=${encodeURIComponent(code)}&days=100`
    );

    const history = await response.json();

    if (!response.ok || !history.ok) {
      return res.status(500).json({
        ok: false,
        error: "market-history 조회 실패",
        detail: history
      });
    }

    const newestFirst = Array.isArray(history.chart)
      ? history.chart
      : [];

    if (newestFirst.length < 60) {
      return res.status(422).json({
        ok: false,
        error: "점수 계산에 필요한 거래일 데이터가 부족합니다.",
        collectedDays: newestFirst.length
      });
    }

    // 계산하기 편하도록 과거 → 최신
    const rows = [...newestFirst].reverse();

    const latest = rows[rows.length - 1];

    /* ==========================================
       HELPERS
    ========================================== */

    const num = value => {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    };

    const clamp = (value, min, max) =>
      Math.max(min, Math.min(max, value));

    const pct = (current, previous) => {
      current = num(current);
      previous = num(previous);

      if (!previous) return 0;

      return ((current - previous) / previous) * 100;
    };

    const average = values => {
      const valid = values
        .map(num)
        .filter(v => Number.isFinite(v));

      if (!valid.length) return 0;

      return valid.reduce((a, b) => a + b, 0) / valid.length;
    };

    const getBack = days => {
      const index = rows.length - 1 - days;
      return index >= 0 ? rows[index] : null;
    };

    const close = num(latest.close);
    const ma5 = num(latest.ma5);
    const ma20 = num(latest.ma20);
    const ma60 = num(latest.ma60);

    const row5 = getBack(5);
    const row10 = getBack(10);
    const row20 = getBack(20);
    const row60 = getBack(60);

    const return5 = row5
      ? pct(close, row5.close)
      : 0;

    const return10 = row10
      ? pct(close, row10.close)
      : 0;

    const return20 = row20
      ? pct(close, row20.close)
      : 0;

    const return60 = row60
      ? pct(close, row60.close)
      : 0;

    const ma20FiveDaysAgo =
      row5 ? num(row5.ma20) : 0;

    const ma60FiveDaysAgo =
      row5 ? num(row5.ma60) : 0;

    const ma20Rising =
      ma20 > 0 &&
      ma20FiveDaysAgo > 0 &&
      ma20 > ma20FiveDaysAgo;

    const ma60Rising =
      ma60 > 0 &&
      ma60FiveDaysAgo > 0 &&
      ma60 > ma60FiveDaysAgo;

    const alignment =
      close > ma5 &&
      ma5 > ma20 &&
      ma20 > ma60;

    const ma20To60Gap =
      ma60 > 0
        ? pct(ma20, ma60)
        : 0;

    const distance20 =
      ma20 > 0
        ? pct(close, ma20)
        : 0;

    const distance60 =
      ma60 > 0
        ? pct(close, ma60)
        : 0;

    /* ==========================================
       거래량 / 거래대금 변화
    ========================================== */

    const recent5 = rows.slice(-5);
    const previous20 = rows.slice(-25, -5);

    const avgVolume5 =
      average(recent5.map(x => x.volume));

    const avgVolume20 =
      average(previous20.map(x => x.volume));

    const volumeRatio =
      avgVolume20 > 0
        ? avgVolume5 / avgVolume20
        : 1;

    const avgValue5 =
      average(recent5.map(x => x.tradingValue));

    const avgValue20 =
      average(previous20.map(x => x.tradingValue));

    const valueRatio =
      avgValue20 > 0
        ? avgValue5 / avgValue20
        : 1;

    /* ==========================================
       최근 고점 / 돌파 / 고점권
    ========================================== */

    const last20BeforeToday =
      rows.slice(-21, -1);

    const high20 =
      last20BeforeToday.length
        ? Math.max(
            ...last20BeforeToday.map(x => num(x.high))
          )
        : close;

    const breakout20 =
      high20 > 0 &&
      close > high20;

    const distanceFromHigh20 =
      high20 > 0
        ? pct(close, high20)
        : 0;

    /* ==========================================
       1. LEADER SCORE
       "현재 실제 주도주인가?"
       0 ~ 100
    ========================================== */

    let leaderTrend = 0;
    const leaderReasons = [];
    const leaderWarnings = [];

    // 추세 품질 30점
    if (close > ma20) {
      leaderTrend += 6;
      leaderReasons.push("현재가가 MA20 위");
    } else {
      leaderWarnings.push("현재가가 MA20 아래");
    }

    if (close > ma60) {
      leaderTrend += 6;
      leaderReasons.push("현재가가 MA60 위");
    } else {
      leaderWarnings.push("현재가가 MA60 아래");
    }

    if (ma5 > ma20) {
      leaderTrend += 6;
      leaderReasons.push("MA5 > MA20");
    }

    if (ma20Rising) {
      leaderTrend += 6;
      leaderReasons.push("MA20 상승 중");
    } else {
      leaderWarnings.push("MA20 상승 추세 미확인");
    }

    if (ma60Rising) {
      leaderTrend += 6;
      leaderReasons.push("MA60 상승 중");
    } else {
      leaderWarnings.push("MA60 상승 추세 미확인");
    }

    // 정배열 20점
    let leaderAlignment = 0;

    if (alignment) {
      leaderAlignment = 20;
      leaderReasons.push(
        "현재가 > MA5 > MA20 > MA60 완전 정배열"
      );
    } else if (
      close > ma60 &&
      ma5 > ma20 &&
      ma20Rising &&
      ma20To60Gap >= -3
    ) {
      leaderAlignment = 13;
      leaderReasons.push(
        "정배열 전환 근접"
      );
      leaderWarnings.push(
        "완전 정배열은 아직 미완성"
      );
    } else if (
      close > ma20 &&
      ma5 > ma20
    ) {
      leaderAlignment = 7;
      leaderWarnings.push(
        "단기 추세는 강하지만 장기 정배열 미완성"
      );
    }

    // 모멘텀 20점
    let leaderMomentum = 0;

    if (return20 >= 15) leaderMomentum += 8;
    else if (return20 >= 8) leaderMomentum += 6;
    else if (return20 >= 3) leaderMomentum += 4;
    else if (return20 > 0) leaderMomentum += 2;

    if (return60 >= 25) leaderMomentum += 8;
    else if (return60 >= 15) leaderMomentum += 6;
    else if (return60 >= 5) leaderMomentum += 4;
    else if (return60 > 0) leaderMomentum += 2;

    if (breakout20) {
      leaderMomentum += 4;
      leaderReasons.push("20거래일 고점 돌파");
    }

    // 거래대금/거래량 20점
    let leaderActivity = 0;

    if (avgValue5 >= 500000000000) leaderActivity += 10;
    else if (avgValue5 >= 200000000000) leaderActivity += 8;
    else if (avgValue5 >= 100000000000) leaderActivity += 6;
    else if (avgValue5 >= 30000000000) leaderActivity += 4;
    else if (avgValue5 >= 10000000000) leaderActivity += 2;

    if (valueRatio >= 2) {
      leaderActivity += 6;
      leaderReasons.push("최근 거래대금 강하게 증가");
    } else if (valueRatio >= 1.4) {
      leaderActivity += 5;
      leaderReasons.push("최근 거래대금 증가");
    } else if (valueRatio >= 1.1) {
      leaderActivity += 3;
    }

    if (volumeRatio >= 1.5) {
      leaderActivity += 4;
      leaderReasons.push("최근 거래량 확장");
    } else if (volumeRatio >= 1.1) {
      leaderActivity += 2;
    }

    leaderActivity = clamp(
      leaderActivity,
      0,
      20
    );

    // 지속성 10점
    let leaderPersistence = 0;

    if (return5 > 0) leaderPersistence += 2;
    if (return10 > 0) leaderPersistence += 2;
    if (return20 > 0) leaderPersistence += 3;
    if (return60 > 0) leaderPersistence += 3;

    let leaderScore =
      leaderTrend +
      leaderAlignment +
      leaderMomentum +
      leaderActivity +
      leaderPersistence;

    leaderScore = clamp(
      Math.round(leaderScore),
      0,
      100
    );

    /* ==========================================
       2. EARLY SCORE
       "차기 주도주 초입인가?"
       이미 너무 오른 종목은 감점
    ========================================== */

    let earlyTransition = 0;
    let earlyMomentum = 0;
    let earlyActivity = 0;
    let earlyPosition = 0;
    let earlyPenalty = 0;

    const earlyReasons = [];
    const earlyWarnings = [];

    // 추세 전환 30점
    if (ma5 > ma20) {
      earlyTransition += 7;
      earlyReasons.push("MA5가 MA20 위");
    }

    if (ma20Rising) {
      earlyTransition += 8;
      earlyReasons.push("MA20 상승 전환");
    }

    if (
      ma20To60Gap >= -3 &&
      ma20To60Gap < 0
    ) {
      earlyTransition += 10;
      earlyReasons.push(
        "MA20/MA60 골든크로스 임박"
      );
    } else if (
      ma20 >= ma60 &&
      ma20To60Gap <= 5
    ) {
      earlyTransition += 7;
      earlyReasons.push(
        "MA20/MA60 초기 골든크로스 구간"
      );
    }

    if (close > ma60) {
      earlyTransition += 5;
      earlyReasons.push("현재가가 MA60 위");
    }

    // 모멘텀 개선 20점
    if (return5 > 0 && return5 <= 10) {
      earlyMomentum += 6;
    }

    if (return10 > 2 && return10 <= 18) {
      earlyMomentum += 6;
    }

    if (return20 > 3 && return20 <= 25) {
      earlyMomentum += 8;
      earlyReasons.push(
        "중기 모멘텀 형성"
      );
    }

    // 거래대금/거래량 확장 25점
    if (valueRatio >= 2) {
      earlyActivity += 15;
      earlyReasons.push(
        "거래대금 20일 평균 대비 2배 이상"
      );
    } else if (valueRatio >= 1.5) {
      earlyActivity += 12;
      earlyReasons.push(
        "거래대금 유입 확대"
      );
    } else if (valueRatio >= 1.2) {
      earlyActivity += 8;
    }

    if (volumeRatio >= 1.8) {
      earlyActivity += 10;
      earlyReasons.push(
        "거래량 강한 확장"
      );
    } else if (volumeRatio >= 1.3) {
      earlyActivity += 7;
    } else if (volumeRatio >= 1.1) {
      earlyActivity += 4;
    }

    // 위치 25점
    if (distance20 >= 0 && distance20 <= 5) {
      earlyPosition += 12;
      earlyReasons.push(
        "MA20 근처의 부담 낮은 위치"
      );
    } else if (
      distance20 > 5 &&
      distance20 <= 10
    ) {
      earlyPosition += 8;
    } else if (
      distance20 > 10 &&
      distance20 <= 15
    ) {
      earlyPosition += 4;
    }

    if (
      distance60 >= 0 &&
      distance60 <= 10
    ) {
      earlyPosition += 8;
    } else if (
      distance60 > 10 &&
      distance60 <= 18
    ) {
      earlyPosition += 4;
    }

    if (
      distanceFromHigh20 >= -5 &&
      distanceFromHigh20 <= 2
    ) {
      earlyPosition += 5;
      earlyReasons.push(
        "최근 고점 돌파 시도 구간"
      );
    }

    // 이미 과도하게 오른 경우 EARLY 감점
    if (return5 >= 20) {
      earlyPenalty += 12;
      earlyWarnings.push(
        "5거래일 급등으로 초입 매력 감소"
      );
    }

    if (return20 >= 35) {
      earlyPenalty += 12;
      earlyWarnings.push(
        "20거래일 상승폭 과대"
      );
    }

    if (distance20 >= 18) {
      earlyPenalty += 10;
      earlyWarnings.push(
        "MA20 대비 과도한 이격"
      );
    }

    let earlyScore =
      earlyTransition +
      earlyMomentum +
      earlyActivity +
      earlyPosition -
      earlyPenalty;

    earlyScore = clamp(
      Math.round(earlyScore),
      0,
      100
    );

    /* ==========================================
       3. EXHAUSTION RISK
       "공세 소멸 위험"
       높을수록 위험
    ========================================== */

    let exhaustionMomentum = 0;
    let exhaustionExtension = 0;
    let exhaustionActivity = 0;
    let exhaustionTrend = 0;

    const exhaustionReasons = [];

    // 급등 후 단기 모멘텀 둔화
    if (
      return20 >= 20 &&
      return5 <= 1
    ) {
      exhaustionMomentum += 15;
      exhaustionReasons.push(
        "중기 급등 후 단기 모멘텀 둔화"
      );
    }

    if (
      return60 >= 35 &&
      return10 < 0
    ) {
      exhaustionMomentum += 15;
      exhaustionReasons.push(
        "장기 강세 이후 최근 모멘텀 약화"
      );
    }

    // 이평선 과이격
    if (distance20 >= 25) {
      exhaustionExtension += 25;
      exhaustionReasons.push(
        "MA20 대비 극단적 과이격"
      );
    } else if (distance20 >= 18) {
      exhaustionExtension += 18;
      exhaustionReasons.push(
        "MA20 대비 높은 과이격"
      );
    } else if (distance20 >= 12) {
      exhaustionExtension += 10;
    }

    // 거래량/거래대금 피크 후 가격 정체
    if (
      volumeRatio >= 2 &&
      return5 <= 1
    ) {
      exhaustionActivity += 12;
      exhaustionReasons.push(
        "대량 거래에도 가격 상승 둔화"
      );
    }

    if (
      valueRatio >= 2 &&
      return5 < 0
    ) {
      exhaustionActivity += 13;
      exhaustionReasons.push(
        "거래대금 급증 중 가격 약세"
      );
    }

    // 단기 추세 붕괴
    if (close < ma5) {
