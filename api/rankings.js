module.exports = async function handler(req, res) {
  try {
    /* =========================================================
       LEADER CYCLE - RANKINGS V4 BULK

       핵심 구조

       market-scan
          ↓
       후보 종목 확보
          ↓
       KRX 날짜별 시장 데이터 공동 수집
          ↓
       후보 전체 history 동시 생성
          ↓
       후보별 점수 계산
          ↓
       ENTRY / LEADER / EARLY / EXHAUSTION

       중요:
       stock-detail / market-history를 후보마다 호출하지 않는다.
       ========================================================= */

    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const host = req.headers.host;

    if (!host) {
      return res.status(500).json({
        ok: false,
        error: "host 정보를 확인할 수 없습니다."
      });
    }

    const baseUrl =
      `${protocol}://${host}`;

    const apiKey =
      process.env.KRX_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "KRX_API_KEY 환경변수가 없습니다."
      });
    }

    /* =========================================================
       HELPERS
       ========================================================= */

    function num(value) {
      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        return 0;
      }

      const cleaned =
        String(value)
          .replace(/,/g, "")
          .trim();

      const n =
        Number(cleaned);

      return Number.isFinite(n)
        ? n
        : 0;
    }

    function clamp(value, min, max) {
      return Math.max(
        min,
        Math.min(max, value)
      );
    }

    function pct(current, previous) {
      current = num(current);
      previous = num(previous);

      if (!previous) {
        return 0;
      }

      return (
        ((current - previous) / previous) *
        100
      );
    }

    function average(values) {
      if (!Array.isArray(values)) {
        return 0;
      }

      const valid =
        values
          .map(num)
          .filter(v =>
            Number.isFinite(v)
          );

      if (!valid.length) {
        return 0;
      }

      return (
        valid.reduce(
          (a, b) => a + b,
          0
        ) / valid.length
      );
    }

    function normalizeCode(value) {
      const raw =
        String(value || "").trim();

      if (/^\d{6}$/.test(raw)) {
        return raw;
      }

      const match =
        raw.match(/(\d{6})/);

      return match
        ? match[1]
        : raw;
    }

    function makeDate(date) {
      const y =
        date.getFullYear();

      const m =
        String(
          date.getMonth() + 1
        ).padStart(2, "0");

      const d =
        String(
          date.getDate()
        ).padStart(2, "0");

      return `${y}${m}${d}`;
    }

    /* =========================================================
       요청 옵션

       기본 10종목.

       bulk 방식이라 기존보다 훨씬 효율적이지만
       모바일/Vercel 안정성을 위해 기본 10.
       ========================================================= */

    const requestedLimit =
      parseInt(
        req.query.limit || "10",
        10
      );

    const limit =
      clamp(
        Number.isFinite(requestedLimit)
          ? requestedLimit
          : 10,
        5,
        20
      );

    const requestedDate =
      String(
        req.query.date || ""
      ).trim();

    /* =========================================================
       1. MARKET SCAN

       최신 시장에서 후보만 먼저 고른다.
       ========================================================= */

    let scanUrl =
      `${baseUrl}/api/market-scan?limit=${limit}`;

    if (/^\d{8}$/.test(requestedDate)) {
      scanUrl +=
        `&date=${requestedDate}`;
    }

    const scanResponse =
      await fetch(scanUrl);

    let scan;

    try {
      scan =
        await scanResponse.json();
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error:
          "market-scan 응답을 읽지 못했습니다."
      });
    }

    if (
      !scanResponse.ok ||
      !scan.ok ||
      !Array.isArray(scan.candidates)
    ) {
      return res.status(500).json({
        ok: false,
        error:
          "market-scan 호출 실패",
        detail:
          scan
      });
    }

    const candidates =
      scan.candidates
        .slice(0, limit)
        .filter(x =>
          /^\d{6}$/.test(
            String(x.code || "")
          )
        );

    if (!candidates.length) {
      return res.status(404).json({
        ok: false,
        error:
          "정밀분석 후보 종목이 없습니다."
      });
    }

    /* =========================================================
       후보 MAP

       한 번 받아온 시장 데이터에서
       필요한 종목만 즉시 추출하기 위함.
       ========================================================= */

    const candidateMap =
      new Map();

    candidates.forEach(candidate => {
      candidateMap.set(
        String(candidate.code),
        candidate
      );
    });

    const candidateCodes =
      new Set(
        candidates.map(x =>
          String(x.code)
        )
      );

    /* =========================================================
       각 종목 history 저장소
       ========================================================= */

    const histories =
      new Map();

    candidates.forEach(candidate => {
      histories.set(
        String(candidate.code),
        []
      );
    });

    const marketMap =
      new Map();

    /* =========================================================
       날짜 기준

       scan이 실제로 사용한 날짜를 기준으로
       과거로 내려간다.

       rankings / scan 날짜 불일치 방지.
       ========================================================= */

    const scanDate =
      String(scan.date || "");

    let baseDate;

    if (/^\d{8}$/.test(scanDate)) {
      baseDate =
        new Date(
          Number(scanDate.slice(0, 4)),
          Number(scanDate.slice(4, 6)) - 1,
          Number(scanDate.slice(6, 8))
        );
    } else {
      const now =
        new Date();

      baseDate =
        new Date(
          now.toLocaleString(
            "en-US",
            {
              timeZone:
                "Asia/Seoul"
            }
          )
        );
    }

    /* =========================================================
       후보 날짜

       100 거래일 확보 목적.

       약 155일이면 보통 충분하지만
       휴장일 여유를 포함해 180일.
       ========================================================= */

    const candidateDates = [];

    for (
      let i = 0;
      i < 180;
      i++
    ) {
      const target =
        new Date(baseDate);

      target.setDate(
        baseDate.getDate() - i
      );

      const day =
        target.getDay();

      if (
        day === 0 ||
        day === 6
      ) {
        continue;
      }

      candidateDates.push(
        makeDate(target)
      );
    }

    /* =========================================================
       KRX ENDPOINT
       ========================================================= */

    const KOSPI_URL =
      "https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd";

    const KOSDAQ_URL =
      "https://data-dbg.krx.co.kr/svc/apis/sto/ksq_bydd_trd";

    async function fetchMarket(
      date,
      market
    ) {
      const endpoint =
        market === "KOSDAQ"
          ? KOSDAQ_URL
          : KOSPI_URL;

      try {
        const response =
          await fetch(
            `${endpoint}?basDd=${date}`,
            {
              headers: {
                AUTH_KEY:
                  apiKey
              }
            }
          );

        if (!response.ok) {
          return {
            ok: false,
            date,
            market,
            rows: []
          };
        }

        const json =
          await response.json();

        return {
          ok: true,
          date,
          market,
          rows:
            Array.isArray(
              json.OutBlock_1
            )
              ? json.OutBlock_1
              : []
        };

      } catch (error) {
        return {
          ok: false,
          date,
          market,
          rows: []
        };
      }
    }

    /* =========================================================
       KRX row 변환
       ========================================================= */

    function convertRow(
      row,
      market,
      code
    ) {
      return {
        date:
          String(
            row.BAS_DD || ""
          ),

        code,

        name:
          String(
            row.ISU_NM || ""
          ).trim(),

        market,

        open:
          num(
            row.TDD_OPNPRC
          ),

        high:
          num(
            row.TDD_HGPRC
          ),

        low:
          num(
            row.TDD_LWPRC
          ),

        close:
          num(
            row.TDD_CLSPRC
          ),

        changeRate:
          num(
            row.FLUC_RT
          ),

        volume:
          num(
            row.ACC_TRDVOL
          ),

        tradingValue:
          num(
            row.ACC_TRDVAL
          ),

        marketCap:
          num(
            row.MKTCAP
          )
      };
    }

    /* =========================================================
       2. BULK HISTORY

       날짜 하나:
         KOSPI 1회
         KOSDAQ 1회

       응답에서 후보 전체를 동시에 찾는다.

       이것이 이번 버전 핵심.
       ========================================================= */

    const WANTED_DAYS = 100;

    function allEnough() {
      for (
        const candidate of candidates
      ) {
        const rows =
          histories.get(
            String(candidate.code)
          );

        if (
          !rows ||
          rows.length <
            WANTED_DAYS
        ) {
          return false;
        }
      }

      return true;
    }

    /*
      한 번에 날짜 4개.

      날짜당 KOSPI/KOSDAQ 2개이므로
      최대 8 request 병렬.

      너무 크게 잡으면 KRX/Vercel에
      순간 부하가 커질 수 있다.
    */

    const DATE_BATCH_SIZE = 4;

    for (
      let i = 0;
      i < candidateDates.length;
      i += DATE_BATCH_SIZE
    ) {
      if (allEnough()) {
        break;
      }

      const dateBatch =
        candidateDates.slice(
          i,
          i + DATE_BATCH_SIZE
        );

      const jobs = [];

      for (
        const date of dateBatch
      ) {
        jobs.push(
          fetchMarket(
            date,
            "KOSPI"
          )
        );

        jobs.push(
          fetchMarket(
            date,
            "KOSDAQ"
          )
        );
      }

      const results =
        await Promise.all(jobs);

      for (
        const result of results
      ) {
        if (
          !result ||
          !result.ok ||
          !Array.isArray(result.rows)
        ) {
          continue;
        }

        for (
          const row of result.rows
        ) {
          const code =
            normalizeCode(
              row.ISU_CD
            );

          if (
            !candidateCodes.has(code)
          ) {
            continue;
          }

          const history =
            histories.get(code);

          if (
            !history ||
            history.length >=
              WANTED_DAYS
          ) {
            continue;
          }

          const converted =
            convertRow(
              row,
              result.market,
              code
            );

          if (
            !converted.date ||
            converted.close <= 0
          ) {
            continue;
          }

          /*
            날짜 중복 방지
          */

          if (
            history.some(
              x =>
                x.date ===
                converted.date
            )
          ) {
            continue;
          }

          history.push(
            converted
          );

          if (
            !marketMap.has(code)
          ) {
            marketMap.set(
              code,
              result.market
            );
          }
        }
      }
    }

    /* =========================================================
       MOVING AVERAGE 생성

       history:
       최신 → 과거

       stock-detail에서는
       과거 → 최신으로 바꿔 계산한다.
       ========================================================= */

    function addMovingAverages(
      source
    ) {
      const selected =
        [...source]
          .sort(
            (a, b) =>
              b.date.localeCompare(
                a.date
              )
          )
          .slice(
            0,
            WANTED_DAYS
          );

      function movingAverage(
        index,
        period
      ) {
        const slice =
          selected.slice(
            index,
            index + period
          );

        if (
          slice.length <
          period
        ) {
          return null;
        }

        const sum =
          slice.reduce(
            (total, row) =>
              total +
              num(row.close),
            0
          );

        return (
          Math.round(
            (sum / period) *
            100
          ) / 100
        );
      }

      return selected.map(
        (row, index) => ({
          ...row,

          ma5:
            movingAverage(
              index,
              5
            ),

          ma20:
            movingAverage(
              index,
              20
            ),

          ma60:
            movingAverage(
              index,
              60
            )
        })
      );
    }

    /* =========================================================
       3. SCORE ENGINE

       기존 stock-detail 로직을
       rankings 내부에서 직접 계산.

       API 왕복 제거.
       ========================================================= */

    function analyzeCandidate(
      candidate,
      newestFirst
    ) {
      if (
        !Array.isArray(
          newestFirst
        ) ||
        newestFirst.length < 65
      ) {
        return {
          ok: false,
          code:
            candidate.code,
          name:
            candidate.name,
          market:
            marketMap.get(
              candidate.code
            ) || null,
          collectedDays:
            newestFirst
              ? newestFirst.length
              : 0,
          error:
            "과거 데이터 부족"
        };
      }

      /*
        과거 → 최신
      */

      const rows =
        [...newestFirst]
          .reverse();

      const latest =
        rows[
          rows.length - 1
        ];

      function getBack(days) {
        const index =
          rows.length -
          1 -
          days;

        if (index < 0) {
          return null;
        }

        return rows[index];
      }

      const close =
        num(latest.close);

      const ma5 =
        num(latest.ma5);

      const ma20 =
        num(latest.ma20);

      const ma60 =
        num(latest.ma60);

      const row5 =
        getBack(5);

      const row10 =
        getBack(10);

      const row20 =
        getBack(20);

      const row60 =
        getBack(60);

      const return5 =
        row5
          ? pct(
              close,
              row5.close
            )
          : 0;

      const return10 =
        row10
          ? pct(
              close,
              row10.close
            )
          : 0;

      const return20 =
        row20
          ? pct(
              close,
              row20.close
            )
          : 0;

      const return60 =
        row60
          ? pct(
              close,
              row60.close
            )
          : 0;

      const ma20FiveDaysAgo =
        row5
          ? num(row5.ma20)
          : 0;

      const ma60FiveDaysAgo =
        row5
          ? num(row5.ma60)
          : 0;

      const ma20Rising =
        ma20 > 0 &&
        ma20FiveDaysAgo > 0 &&
        ma20 >
          ma20FiveDaysAgo;

      const ma60Rising =
        ma60 > 0 &&
        ma60FiveDaysAgo > 0 &&
        ma60 >
          ma60FiveDaysAgo;

      const alignment =
        close > ma5 &&
        ma5 > ma20 &&
        ma20 > ma60;

      const ma20To60Gap =
        ma60 > 0
          ? pct(
              ma20,
              ma60
            )
          : 0;

      const distance20 =
        ma20 > 0
          ? pct(
              close,
              ma20
            )
          : 0;

      const distance60 =
        ma60 > 0
          ? pct(
              close,
              ma60
            )
          : 0;

      /* =====================================================
         거래활동
         ===================================================== */

      const recent5 =
        rows.slice(-5);

      const previous20 =
        rows.slice(
          -25,
          -5
        );

      const avgVolume5 =
        average(
          recent5.map(
            x => x.volume
          )
        );

      const avgVolume20 =
        average(
          previous20.map(
            x => x.volume
          )
        );

      const volumeRatio =
        avgVolume20 > 0
          ? avgVolume5 /
            avgVolume20
          : 1;

      const avgValue5 =
        average(
          recent5.map(
            x =>
              x.tradingValue
          )
        );

      const avgValue20 =
        average(
          previous20.map(
            x =>
              x.tradingValue
          )
        );

      const valueRatio =
        avgValue20 > 0
          ? avgValue5 /
            avgValue20
          : 1;

      /* =====================================================
         20일 고점
         ===================================================== */

      const last20BeforeToday =
        rows.slice(
          -21,
          -1
        );

      let high20 =
        close;

      if (
        last20BeforeToday.length
      ) {
        high20 =
          Math.max(
            ...last20BeforeToday.map(
              x =>
                num(x.high)
            )
          );
      }

      const breakout20 =
        high20 > 0 &&
        close > high20;

      const distanceFromHigh20 =
        high20 > 0
          ? pct(
              close,
              high20
            )
          : 0;

      /* =====================================================
         LEADER SCORE
         ===================================================== */

      let leaderTrend = 0;
      let leaderAlignment = 0;
      let leaderMomentum = 0;
      let leaderActivity = 0;
      let leaderPersistence = 0;

      const leaderReasons = [];
      const leaderWarnings = [];

      if (close > ma20) {
        leaderTrend += 6;
        leaderReasons.push(
          "현재가가 MA20 위"
        );
      } else {
        leaderWarnings.push(
          "현재가가 MA20 아래"
        );
      }

      if (close > ma60) {
        leaderTrend += 6;
        leaderReasons.push(
          "현재가가 MA60 위"
        );
      } else {
        leaderWarnings.push(
          "현재가가 MA60 아래"
        );
      }

      if (ma5 > ma20) {
        leaderTrend += 6;
        leaderReasons.push(
          "MA5 > MA20"
        );
      }

      if (ma20Rising) {
        leaderTrend += 6;
        leaderReasons.push(
          "MA20 상승 중"
        );
      } else {
        leaderWarnings.push(
          "MA20 상승 추세 미확인"
        );
      }

      if (ma60Rising) {
        leaderTrend += 6;
        leaderReasons.push(
          "MA60 상승 중"
        );
      } else {
        leaderWarnings.push(
          "MA60 상승 추세 미확인"
        );
      }

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

      if (return20 >= 15) {
        leaderMomentum += 8;
      } else if (
        return20 >= 8
      ) {
        leaderMomentum += 6;
      } else if (
        return20 >= 3
      ) {
        leaderMomentum += 4;
      } else if (
        return20 > 0
      ) {
        leaderMomentum += 2;
      }

      if (return60 >= 25) {
        leaderMomentum += 8;
      } else if (
        return60 >= 15
      ) {
        leaderMomentum += 6;
      } else if (
        return60 >= 5
      ) {
        leaderMomentum += 4;
      } else if (
        return60 > 0
      ) {
        leaderMomentum += 2;
      }

      if (breakout20) {
        leaderMomentum += 4;

        leaderReasons.push(
          "20거래일 고점 돌파"
        );
      }

      if (
        avgValue5 >=
        500000000000
      ) {
        leaderActivity += 10;

      } else if (
        avgValue5 >=
        200000000000
      ) {
        leaderActivity += 8;

      } else if (
        avgValue5 >=
        100000000000
      ) {
        leaderActivity += 6;

      } else if (
        avgValue5 >=
        30000000000
      ) {
        leaderActivity += 4;

      } else if (
        avgValue5 >=
        10000000000
      ) {
        leaderActivity += 2;
      }

      if (valueRatio >= 2) {
        leaderActivity += 6;

        leaderReasons.push(
          "최근 거래대금 강하게 증가"
        );

      } else if (
        valueRatio >= 1.4
      ) {
        leaderActivity += 5;

        leaderReasons.push(
          "최근 거래대금 증가"
        );

      } else if (
        valueRatio >= 1.1
      ) {
        leaderActivity += 3;
      }

      if (volumeRatio >= 1.5) {
        leaderActivity += 4;

        leaderReasons.push(
          "최근 거래량 확장"
        );

      } else if (
        volumeRatio >= 1.1
      ) {
        leaderActivity += 2;
      }

      leaderActivity =
        clamp(
          leaderActivity,
          0,
          20
        );

      if (return5 > 0) {
        leaderPersistence += 2;
      }

      if (return10 > 0) {
        leaderPersistence += 2;
      }

      if (return20 > 0) {
        leaderPersistence += 3;
      }

      if (return60 > 0) {
        leaderPersistence += 3;
      }

      let leaderScore =
        leaderTrend +
        leaderAlignment +
        leaderMomentum +
        leaderActivity +
        leaderPersistence;

      leaderScore =
        clamp(
          Math.round(
            leaderScore
          ),
          0,
          100
        );

      /* =====================================================
         EARLY SCORE
         ===================================================== */

      let earlyTransition = 0;
      let earlyMomentum = 0;
      let earlyActivity = 0;
      let earlyPosition = 0;
      let earlyPenalty = 0;

      const earlyReasons = [];
      const earlyWarnings = [];

      if (ma5 > ma20) {
        earlyTransition += 7;

        earlyReasons.push(
          "MA5가 MA20 위"
        );
      }

      if (ma20Rising) {
        earlyTransition += 8;

        earlyReasons.push(
          "MA20 상승 전환"
        );
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

        earlyReasons.push(
          "현재가가 MA60 위"
        );
      }

      if (
        return5 > 0 &&
        return5 <= 10
      ) {
        earlyMomentum += 6;
      }

      if (
        return10 > 2 &&
        return10 <= 18
      ) {
        earlyMomentum += 6;
      }

      if (
        return20 > 3 &&
        return20 <= 25
      ) {
        earlyMomentum += 8;

        earlyReasons.push(
          "중기 모멘텀 형성"
        );
      }

      if (valueRatio >= 2) {
        earlyActivity += 15;

        earlyReasons.push(
          "거래대금 20일 평균 대비 2배 이상"
        );

      } else if (
        valueRatio >= 1.5
      ) {
        earlyActivity += 12;

        earlyReasons.push(
          "거래대금 유입 확대"
        );

      } else if (
        valueRatio >= 1.2
      ) {
        earlyActivity += 8;
      }

      if (volumeRatio >= 1.8) {
        earlyActivity += 10;

        earlyReasons.push(
          "거래량 강한 확장"
        );

      } else if (
        volumeRatio >= 1.3
      ) {
        earlyActivity += 7;

      } else if (
        volumeRatio >= 1.1
      ) {
        earlyActivity += 4;
      }

      if (
        distance20 >= 0 &&
        distance20 <= 5
      ) {
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

      earlyScore =
        clamp(
          Math.round(
            earlyScore
          ),
          0,
          100
        );

      /* =====================================================
         EXHAUSTION SCORE
         ===================================================== */

      let exhaustionMomentum = 0;
      let exhaustionExtension = 0;
      let exhaustionActivity = 0;
      let exhaustionTrend = 0;

      const exhaustionReasons = [];

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

      if (distance20 >= 25) {
        exhaustionExtension += 25;

        exhaustionReasons.push(
          "MA20 대비 극단적 과이격"
        );

      } else if (
        distance20 >= 18
      ) {
        exhaustionExtension += 18;

        exhaustionReasons.push(
          "MA20 대비 높은 과이격"
        );

      } else if (
        distance20 >= 12
      ) {
        exhaustionExtension += 10;
      }

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

      if (close < ma5) {
        exhaustionTrend += 8;

        exhaustionReasons.push(
          "현재가 MA5 이탈"
        );
      }

      if (close < ma20) {
        exhaustionTrend += 17;

        exhaustionReasons.push(
          "현재가 MA20 이탈"
        );
      }

      if (
        ma5 < ma20 &&
        return60 > 15
      ) {
        exhaustionTrend += 10;

        exhaustionReasons.push(
          "강한 상승 이후 MA5/MA20 약화"
        );
      }

      let exhaustionScore =
        exhaustionMomentum +
        exhaustionExtension +
        exhaustionActivity +
        exhaustionTrend;

      exhaustionScore =
        clamp(
          Math.round(
            exhaustionScore
          ),
          0,
          100
        );

      /* =====================================================
         ENTRY SCORE
         ===================================================== */

      let entryTrend = 0;
      let entryPosition = 0;
      let entryMomentum = 0;
      let entryActivity = 0;

      const entryReasons = [];
      const entryWarnings = [];

      if (close > ma20) {
        entryTrend += 6;
      }

      if (close > ma60) {
        entryTrend += 6;
      }

      if (ma5 > ma20) {
        entryTrend += 6;
      }

      if (ma20Rising) {
        entryTrend += 6;
      }

      if (ma60Rising) {
        entryTrend += 6;
      }

      if (entryTrend >= 24) {
        entryReasons.push(
          "주요 추세 조건 양호"
        );
      }

      if (
        distance20 >= 0 &&
        distance20 <= 4
      ) {
        entryPosition += 18;

        entryReasons.push(
          "MA20 대비 이격 부담 낮음"
        );

      } else if (
        distance20 > 4 &&
        distance20 <= 8
      ) {
        entryPosition += 13;

      } else if (
        distance20 > 8 &&
        distance20 <= 12
      ) {
        entryPosition += 7;

      } else if (
        distance20 > 15
      ) {
        entryWarnings.push(
          "MA20 대비 이격 부담"
        );
      }

      if (
        ma20To60Gap >= -2 &&
        ma20To60Gap <= 5
      ) {
        entryPosition += 7;

        entryReasons.push(
          "MA20/MA60 전환 초기 구간"
        );
      }

      if (
        distanceFromHigh20 >= -5 &&
        distanceFromHigh20 <= 2
      ) {
        entryPosition += 5;

        entryReasons.push(
          "20일 고점 부근"
        );
      }

      if (
        return5 > 0 &&
        return5 <= 8
      ) {
        entryMomentum += 7;
      }

      if (
        return10 > 0 &&
        return10 <= 15
      ) {
        entryMomentum += 6;
      }

      if (
        return20 > 2 &&
        return20 <= 25
      ) {
        entryMomentum += 7;
      }

      if (valueRatio >= 2) {
        entryActivity += 12;

        entryReasons.push(
          "거래대금 강한 유입"
        );

      } else if (
        valueRatio >= 1.5
      ) {
        entryActivity += 10;

      } else if (
        valueRatio >= 1.2
      ) {
        entryActivity += 7;

      } else if (
        valueRatio >= 1
      ) {
        entryActivity += 4;
      }

      if (volumeRatio >= 1.5) {
        entryActivity += 8;

      } else if (
        volumeRatio >= 1.2
      ) {
        entryActivity += 5;

      } else if (
        volumeRatio >= 1
      ) {
        entryActivity += 3;
      }

      let exhaustionPenalty = 0;

      if (
        exhaustionScore >= 75
      ) {
        exhaustionPenalty = 50;

        entryWarnings.push(
          "공세 소멸 위험 매우 높음"
        );

      } else if (
        exhaustionScore >= 50
      ) {
        exhaustionPenalty = 25;

        entryWarnings.push(
          "공세 소멸 위험 상승"
        );

      } else if (
        exhaustionScore >= 25
      ) {
        exhaustionPenalty = 10;

        entryWarnings.push(
          "공세 소멸 위험 일부 존재"
        );
      }

      let chasePenalty = 0;

      if (return5 >= 15) {
        chasePenalty += 8;

        entryWarnings.push(
          "최근 5거래일 급등"
        );
      }

      if (distance20 >= 15) {
        chasePenalty += 10;

        entryWarnings.push(
          "MA20 과이격"
        );
      }

      let entryScore =
        entryTrend +
        entryPosition +
        entryMomentum +
        entryActivity -
        exhaustionPenalty -
        chasePenalty;

      entryScore =
        clamp(
          Math.round(
            entryScore
          ),
          0,
          100
        );

      /* =====================================================
         STAGE
         ===================================================== */

      let stage =
        "DISCOVERY";

      if (
        exhaustionScore >= 75
      ) {
        stage =
          "EXHAUSTING";

      } else if (
        close < ma20 &&
        ma5 < ma20
      ) {
        stage =
          "BROKEN";

      } else if (
        leaderScore >= 80 &&
        alignment
      ) {
        stage =
          "LEADER";

      } else if (
        leaderScore >= 70 &&
        exhaustionScore >= 40
      ) {
        stage =
          "MATURE";

      } else if (
        earlyScore >= 70
      ) {
        stage =
          "EMERGING";

      } else if (
        leaderScore >= 60
      ) {
        stage =
          "WATCH";
      }

      /* =====================================================
         ENTRY STATUS
         ===================================================== */

      let entryStatus =
        "AVOID";

      if (
        exhaustionScore >= 75
      ) {
        entryStatus =
          "BLOCKED";

      } else if (
        entryScore >= 80
      ) {
        entryStatus =
          "ATTRACTIVE";

      } else if (
        entryScore >= 65
      ) {
        entryStatus =
          "WATCH";

      } else if (
        entryScore >= 50
      ) {
        entryStatus =
          "NEUTRAL";
      }

      return {
        ok: true,

        code:
          String(
            candidate.code
          ),

        name:
          latest.name ||
          candidate.name,

        market:
          latest.market ||
          marketMap.get(
            candidate.code
          ) ||
          null,

        date:
          latest.date,

        price:
          close,

        changeRate:
          num(
            candidate.changeRate
          ),

        discoveryScore:
          num(
            candidate.discoveryScore
          ),

        tradingValue:
          num(
            candidate.tradingValue
          ),

        marketCap:
          num(
            candidate.marketCap
          ),

        stage,

        entryStatus,

        blocked:
          exhaustionScore >= 75,

        scores: {
          leader:
            leaderScore,

          early:
            earlyScore,

          entry:
            entryScore,

          exhaustion:
            exhaustionScore
        },

        signals: {
          alignment,

          ma20Rising,

          ma60Rising,

          ma20To60Gap:
            Number(
              ma20To60Gap
                .toFixed(2)
            ),

          distance20:
            Number(
              distance20
                .toFixed(2)
            ),

          distance60:
            Number(
              distance60
                .toFixed(2)
            ),

          return5:
            Number(
              return5
                .toFixed(2)
            ),

          return10:
            Number(
              return10
                .toFixed(2)
            ),

          return20:
            Number(
              return20
                .toFixed(2)
            ),

          return60:
            Number(
              return60
                .toFixed(2)
            ),

          volumeRatio:
            Number(
              volumeRatio
                .toFixed(2)
            ),

          tradingValueRatio:
            Number(
              valueRatio
                .toFixed(2)
            ),

          breakout20
        },

        reasons: {
          leader:
            leaderReasons
              .slice(0, 4),

          early:
            earlyReasons
              .slice(0, 4),

          entry:
            entryReasons
              .slice(0, 4),

          exhaustion:
            exhaustionReasons
              .slice(0, 4)
        },

        warnings: {
          leader:
            leaderWarnings
              .slice(0, 3),

          early:
            earlyWarnings
              .slice(0, 3),

          entry:
            entryWarnings
              .slice(0, 3)
        }
      };
    }

    /* =========================================================
       후보 전체 분석
       ========================================================= */

    const results = [];

    for (
      const candidate of candidates
    ) {
      const rawHistory =
        histories.get(
          String(
            candidate.code
          )
        ) || [];

      const chart =
        addMovingAverages(
          rawHistory
        );

      results.push(
        analyzeCandidate(
          candidate,
          chart
        )
      );
    }

    const analyzed =
      results.filter(
        x => x.ok
      );

    const failed =
      results.filter(
        x => !x.ok
      );

    /* =========================================================
       BUYABLE
       ========================================================= */

    const buyable =
      analyzed.filter(
        stock => {
          if (
            stock.blocked
          ) {
            return false;
          }

          if (
            stock.scores
              .exhaustion >= 75
          ) {
            return false;
          }

          if (
            stock.stage ===
              "BROKEN" ||
            stock.stage ===
              "EXHAUSTING"
          ) {
            return false;
          }

          return true;
        }
      );

    /* =========================================================
       ENTRY RANKING
       ========================================================= */

    const entryRanking =
      [...buyable]
        .sort(
          (a, b) => {
            if (
              b.scores.entry !==
              a.scores.entry
            ) {
              return (
                b.scores.entry -
                a.scores.entry
              );
            }

            if (
              a.scores.exhaustion !==
              b.scores.exhaustion
            ) {
              return (
                a.scores.exhaustion -
                b.scores.exhaustion
              );
            }

            return (
              b.scores.leader -
              a.scores.leader
            );
          }
        )
        .slice(0, 10);

    /* =========================================================
       LEADER RANKING
       ========================================================= */

    const leaderRanking =
      [...analyzed]
        .filter(
          stock =>
            !stock.blocked &&
            stock.scores
              .exhaustion < 75
        )
        .sort(
          (a, b) => {
            if (
              b.scores.leader !==
              a.scores.leader
            ) {
              return (
                b.scores.leader -
                a.scores.leader
              );
            }

            return (
              a.scores.exhaustion -
              b.scores.exhaustion
            );
          }
        )
        .slice(0, 10);

    /* =========================================================
       EARLY RANKING
       ========================================================= */

    const earlyRanking =
      [...buyable]
        .sort(
          (a, b) => {
            if (
              b.scores.early !==
              a.scores.early
            ) {
              return (
                b.scores.early -
                a.scores.early
              );
            }

            return (
              b.scores.entry -
              a.scores.entry
            );
          }
        )
        .slice(0, 10);

    /* =========================================================
       EXHAUSTION RANKING
       ========================================================= */

    const exhaustionRanking =
      [...analyzed]
        .filter(
          stock =>
            stock.scores
              .exhaustion >= 25
        )
        .sort(
          (a, b) =>
            b.scores.exhaustion -
            a.scores.exhaustion
        )
        .slice(0, 10);

    /* =========================================================
       TOP PICKS
       ========================================================= */

    const topPicks = {
      entry:
        entryRanking[0] ||
        null,

      leader:
        leaderRanking[0] ||
        null,

      early:
        earlyRanking[0] ||
        null,

      exhaustion:
        exhaustionRanking[0] ||
        null
    };

    /* =========================================================
       MARKET COUNTS
       ========================================================= */

    const analyzedMarket = {
      kospi:
        analyzed.filter(
          x =>
            x.market ===
            "KOSPI"
        ).length,

      kosdaq:
        analyzed.filter(
          x =>
            x.market ===
            "KOSDAQ"
        ).length
    };

    analyzedMarket.total =
      analyzedMarket.kospi +
      analyzedMarket.kosdaq;

    /* =========================================================
       CACHE
       ========================================================= */

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=1800, stale-while-revalidate=3600"
    );

    /* =========================================================
       RESPONSE
       ========================================================= */

    return res.status(200).json({
      ok: true,

      version:
        "LEADER_CYCLE_RANKINGS_V4_BULK",

      architecture:
        "BULK_KRX_HISTORY",

      date:
        scan.date,

      stats: {
        marketStocks:
          scan.market
            ?.totalStocks || 0,

        investableStocks:
          scan.market
            ?.investableStocks || 0,

        discoveryCandidates:
          candidates.length,

        analyzed:
          analyzed.length,

        failed:
          failed.length,

        buyable:
          buyable.length,

        analyzedMarket
      },

      performance: {
        stockDetailDependency:
          false,

        marketHistoryDependency:
          false,

        bulkHistory:
          true,

        wantedHistoryDays:
          WANTED_DAYS,

        dateBatchSize:
          DATE_BATCH_SIZE
      },

      scoreGuide: {
        discovery:
          "정밀분석 대상을 찾기 위한 1차 시장 탐색 점수",

        leader:
          "현재 실제 주도주로서의 추세·정배열·모멘텀·거래활동·지속성을 평가",

        early:
          "아직 과도하게 오르기 전 차기 주도주 전환 가능성을 평가",

        entry:
          "현재 가격에서 신규 매수하기 좋은 위치인지 평가",

        exhaustion:
          "공세 소멸 및 추세 종료 위험. 높을수록 신규매수에 불리"
      },

      topPicks,

      entryRanking,

      leaderRanking,

      earlyRanking,

      exhaustionRanking,

      failed:
        failed.map(
          x => ({
            code:
              x.code,

            name:
              x.name,

            market:
              x.market,

            collectedDays:
              x.collectedDays,

            error:
              x.error
          })
        )
    });

  } catch (error) {
    console.error(
      "RANKINGS V4 BULK ERROR",
      error
    );

    return res.status(500).json({
      ok: false,

      version:
        "LEADER_CYCLE_RANKINGS_V4_BULK",

      error:
        String(
          error?.message ||
          error
        )
    });
  }
};
