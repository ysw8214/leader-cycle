module.exports = async function handler(req, res) {
  const startedAt = Date.now();

  try {
    /* =========================================================
       LEADER CYCLE - RANKINGS V7

       목적
       ---------------------------------------------------------
       시장 전체
         ↓
       MARKET-SCAN 후보 발굴
         ↓
       KRX BULK HISTORY
         ↓
       종목별 사이클 분석
         ↓
       LEADER / EARLY / EXHAUSTION / ENTRY
         ↓
       최종 4개 카테고리

       핵심 철학
       ---------------------------------------------------------
       LEADER
       = 현재 시장을 실제로 이끄는 종목

       EARLY
       = 차기 주도주가 될 가능성이 높은 종목

       EXHAUSTION
       = 기존 공세의 소진 위험

       ENTRY
       = 단순 강한 종목이 아니라
         "공세가 막 시작되는 자리"

       ENTRY 핵심
       ---------------------------------------------------------
       - 정배열 형성/전환
       - MA20 상승
       - MA60 상승/상승 전환
       - MA20/MA60 초기 골든크로스
       - 최근 고점 접근/돌파
       - 거래량/거래대금 증가
       - 지나친 이격/급등은 감점
       - EXHAUSTION 높으면 강한 감점

       주의
       ---------------------------------------------------------
       책의 세부 조건을 임의로 추가하지 않는다.
       현재 확보된 가격/거래량/거래대금 데이터로
       계산 가능한 조건만 사용한다.
    ========================================================= */

    const apiKey = process.env.KRX_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "KRX_API_KEY 환경변수가 없습니다."
      });
    }

    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const host = req.headers.host;

    if (!host) {
      return res.status(500).json({
        ok: false,
        error: "host 정보를 확인할 수 없습니다."
      });
    }

    const baseUrl = `${protocol}://${host}`;

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=1800, stale-while-revalidate=3600"
    );

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

      const n = Number(
        String(value)
          .replace(/,/g, "")
          .trim()
      );

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

      const valid = values
        .map(num)
        .filter(Number.isFinite);

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

    async function fetchJson(
      url,
      timeoutMs = 10000,
      options = {}
    ) {
      const controller =
        new AbortController();

      const timer =
        setTimeout(
          () => controller.abort(),
          timeoutMs
        );

      try {
        const response =
          await fetch(url, {
            ...options,
            signal: controller.signal
          });

        let json = null;

        try {
          json =
            await response.json();
        } catch {
          json = null;
        }

        return {
          ok: response.ok,
          status: response.status,
          json
        };
      } finally {
        clearTimeout(timer);
      }
    }

    /* =========================================================
       OPTIONS
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
        4,
        20
      );

    /*
      history 부족 종목 자동 보충을 위해
      실제 분석 목표보다 후보를 넓게 확보
    */

    const scanLimit =
      clamp(
        limit * 3,
        limit,
        50
      );

    const requestedDate =
      String(
        req.query.date || ""
      ).trim();

    /* =========================================================
       1. MARKET SCAN
    ========================================================= */

    let scanUrl =
      `${baseUrl}/api/market-scan?limit=${scanLimit}`;

    if (/^\d{8}$/.test(requestedDate)) {
      scanUrl +=
        `&date=${encodeURIComponent(
          requestedDate
        )}`;
    }

    let scanResult;

    try {
      scanResult =
        await fetchJson(
          scanUrl,
          10000
        );
    } catch (error) {
      return res.status(504).json({
        ok: false,
        version:
          "LEADER_CYCLE_RANKINGS_V7",
        error:
          "market-scan timeout",
        detail:
          String(
            error?.message ||
            error
          )
      });
    }

    const scan =
      scanResult.json;

    if (
      !scanResult.ok ||
      !scan ||
      !scan.ok ||
      !Array.isArray(
        scan.candidates
      )
    ) {
      return res.status(500).json({
        ok: false,
        version:
          "LEADER_CYCLE_RANKINGS_V7",
        error:
          "market-scan 호출 실패",
        detail: scan
      });
    }

    const candidates =
      scan.candidates.slice(
        0,
        scanLimit
      );

    if (!candidates.length) {
      return res.status(200).json({
        ok: true,

        version:
          "LEADER_CYCLE_RANKINGS_V7",

        date:
          scan.date || null,

        stats: {
          target: limit,
          candidates: 0,
          analyzed: 0,
          skipped: 0,
          buyable: 0
        },

        topPicks: {
          entry: null,
          leader: null,
          early: null,
          exhaustion: null
        },

        entryRanking: [],
        leaderRanking: [],
        earlyRanking: [],
        exhaustionRanking: [],

        skipped: []
      });
    }

    const candidateCodes =
      new Set(
        candidates.map(
          candidate =>
            String(
              candidate.code
            )
        )
      );

    /* =========================================================
       기준 날짜
    ========================================================= */

    const scanDate =
      String(
        scan.date ||
        requestedDate ||
        ""
      );

    let baseDate;

    if (/^\d{8}$/.test(scanDate)) {
      baseDate =
        new Date(
          Number(
            scanDate.slice(0, 4)
          ),
          Number(
            scanDate.slice(4, 6)
          ) - 1,
          Number(
            scanDate.slice(6, 8)
          )
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
       거래일 후보

       100 거래일 확보용.
       주말 제외 + 공휴일 여유.
    ========================================================= */

    const candidateDates = [];

    for (
      let i = 0;
      i < 165;
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

      const url =
        `${endpoint}?basDd=${date}`;

      try {
        const result =
          await fetchJson(
            url,
            7000,
            {
              headers: {
                AUTH_KEY: apiKey
              }
            }
          );

        const rows =
          Array.isArray(
            result.json?.OutBlock_1
          )
            ? result.json.OutBlock_1
            : [];

        return {
          ok: result.ok,
          market,
          date,
          rows
        };
      } catch {
        return {
          ok: false,
          market,
          date,
          rows: []
        };
      }
    }

    /* =========================================================
       HISTORY MAP
    ========================================================= */

    const histories =
      new Map();

    candidates.forEach(
      candidate => {
        histories.set(
          String(
            candidate.code
          ),
          []
        );
      }
    );

    function convertRow(
      row,
      market
    ) {
      const code =
        normalizeCode(
          row.ISU_CD
        );

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

       날짜당
       KOSPI 1회
       KOSDAQ 1회

       종목별 market-history 호출 없음.
    ========================================================= */

    const REQUIRED_DAYS = 100;
    const MIN_ANALYSIS_DAYS = 60;
    const DATE_BATCH_SIZE = 8;

    let krxRequests = 0;

    for (
      let i = 0;
      i < candidateDates.length;
      i += DATE_BATCH_SIZE
    ) {
      const batch =
        candidateDates.slice(
          i,
          i + DATE_BATCH_SIZE
        );

      const jobs = [];

      for (const date of batch) {
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

      krxRequests +=
        jobs.length;

      const results =
        await Promise.all(
          jobs
        );

      for (
        const result of results
      ) {
        if (
          !result ||
          !result.ok ||
          !Array.isArray(
            result.rows
          )
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
            !candidateCodes.has(
              code
            )
          ) {
            continue;
          }

          const history =
            histories.get(code);

          if (!history) {
            continue;
          }

          if (
            history.length >=
            REQUIRED_DAYS
          ) {
            continue;
          }

          const converted =
            convertRow(
              row,
              result.market
            );

          if (
            !converted.date ||
            converted.close <= 0
          ) {
            continue;
          }

          if (
            history.some(
              item =>
                item.date ===
                converted.date
            )
          ) {
            continue;
          }

          history.push(
            converted
          );
        }
      }

      /*
        상위 후보 중 충분한 수가
        100일을 확보했다면 종료
      */

      const completeCount =
        candidates.filter(
          candidate =>
            (
              histories.get(
                String(
                  candidate.code
                )
              ) || []
            ).length >=
            REQUIRED_DAYS
        ).length;

      if (
        completeCount >=
        limit * 2
      ) {
        break;
      }
    }

    /* =========================================================
       3. STOCK ANALYSIS
    ========================================================= */

    function analyzeStock(
      candidate,
      rawHistory
    ) {
      const code =
        String(
          candidate.code
        );

      if (
        !Array.isArray(
          rawHistory
        ) ||
        rawHistory.length <
          MIN_ANALYSIS_DAYS
      ) {
        return {
          ok: false,
          code,
          name:
            candidate.name,
          error:
            `history 부족 (${rawHistory?.length || 0}일)`
        };
      }

      /* -------------------------------------------------------
         최신 → 과거
      ------------------------------------------------------- */

      const newestFirst =
        [...rawHistory]
          .sort(
            (a, b) =>
              b.date.localeCompare(
                a.date
              )
          )
          .slice(
            0,
            REQUIRED_DAYS
          );

      function movingAverage(
        index,
        period
      ) {
        const slice =
          newestFirst.slice(
            index,
            index + period
          );

        if (
          slice.length <
          period
        ) {
          return null;
        }

        return average(
          slice.map(
            row => row.close
          )
        );
      }

      const chart =
        newestFirst.map(
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

      /* -------------------------------------------------------
         과거 → 최신
      ------------------------------------------------------- */

      const rows =
        [...chart].reverse();

      const latest =
        rows[
          rows.length - 1
        ];

      function getBack(days) {
        const index =
          rows.length -
          1 -
          days;

        return index >= 0
          ? rows[index]
          : null;
      }

      const close =
        num(latest.close);

      const ma5 =
        num(latest.ma5);

      const ma20 =
        num(latest.ma20);

      const ma60 =
        num(latest.ma60);

      if (
        close <= 0 ||
        ma20 <= 0 ||
        ma60 <= 0
      ) {
        return {
          ok: false,
          code,
          name:
            candidate.name,
          error:
            "이동평균 데이터 부족"
        };
      }

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

      /* =====================================================
         MOVING AVERAGE STATE
      ===================================================== */

      const ma20FiveDaysAgo =
        row5
          ? num(row5.ma20)
          : 0;

      const ma60FiveDaysAgo =
        row5
          ? num(row5.ma60)
          : 0;

      const ma20Rising =
        ma20FiveDaysAgo > 0 &&
        ma20 >
          ma20FiveDaysAgo;

      const ma60Rising =
        ma60FiveDaysAgo > 0 &&
        ma60 >
          ma60FiveDaysAgo;

      const alignment =
        close > ma5 &&
        ma5 > ma20 &&
        ma20 > ma60;

      const ma20To60Gap =
        pct(
          ma20,
          ma60
        );

      const distance20 =
        pct(
          close,
          ma20
        );

      const distance60 =
        pct(
          close,
          ma60
        );

      /*
        정배열 "존재"와
        정배열 "초기 형성"을 분리한다.

        ENTRY에서 중요.
      */

      let alignment5DaysAgo =
        false;

      if (row5) {
        const oldClose =
          num(row5.close);

        const oldMa5 =
          num(row5.ma5);

        const oldMa20 =
          num(row5.ma20);

        const oldMa60 =
          num(row5.ma60);

        alignment5DaysAgo =
          oldClose > oldMa5 &&
          oldMa5 > oldMa20 &&
          oldMa20 > oldMa60;
      }

      const freshAlignment =
        alignment &&
        !alignment5DaysAgo;

      /*
        MA20 / MA60 골든크로스가
        최근에 발생했는지 확인
      */

      const oldMa20 =
        row5
          ? num(row5.ma20)
          : 0;

      const oldMa60 =
        row5
          ? num(row5.ma60)
          : 0;

      const freshGoldenCross =
        ma20 >= ma60 &&
        oldMa20 > 0 &&
        oldMa60 > 0 &&
        oldMa20 <= oldMa60;

      /* =====================================================
         ACTIVITY
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
            row => row.volume
          )
        );

      const avgVolume20 =
        average(
          previous20.map(
            row => row.volume
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
            row =>
              row.tradingValue
          )
        );

      const avgValue20 =
        average(
          previous20.map(
            row =>
              row.tradingValue
          )
        );

      const valueRatio =
        avgValue20 > 0
          ? avgValue5 /
            avgValue20
          : 1;

      /* =====================================================
         BREAKOUT
      ===================================================== */

      const previous20Rows =
        rows.slice(
          -21,
          -1
        );

      const high20 =
        previous20Rows.length
          ? Math.max(
              ...previous20Rows.map(
                row =>
                  num(
                    row.high ||
                    row.close
                  )
              )
            )
          : close;

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

      /*
        고점 바로 아래 압축/돌파대기 영역
      */

      const nearBreakout =
        distanceFromHigh20 >= -5 &&
        distanceFromHigh20 <= 0;

      /* =====================================================
         LEADER
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
          "현재가 MA20 위"
        );
      }

      if (close > ma60) {
        leaderTrend += 6;
        leaderReasons.push(
          "현재가 MA60 위"
        );
      }

      if (ma5 > ma20) {
        leaderTrend += 6;
      }

      if (ma20Rising) {
        leaderTrend += 6;
        leaderReasons.push(
          "MA20 상승"
        );
      }

      if (ma60Rising) {
        leaderTrend += 6;
        leaderReasons.push(
          "MA60 상승"
        );
      }

      if (alignment) {
        leaderAlignment = 20;

        leaderReasons.push(
          "완전 정배열"
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
      } else if (
        close > ma20 &&
        ma5 > ma20
      ) {
        leaderAlignment = 7;
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
          "20일 고점 돌파"
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
          "거래대금 강한 증가"
        );
      } else if (
        valueRatio >= 1.4
      ) {
        leaderActivity += 5;
      } else if (
        valueRatio >= 1.1
      ) {
        leaderActivity += 3;
      }

      if (volumeRatio >= 1.5) {
        leaderActivity += 4;
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
         EARLY
      ===================================================== */

      let earlyTransition = 0;
      let earlyMomentum = 0;
      let earlyActivity = 0;
      let earlyPosition = 0;
      let earlyPenalty = 0;

      const earlyReasons = [];
      const earlyWarnings = [];

      if (ma5 > ma20) {
        earlyTransition += 6;
      }

      if (ma20Rising) {
        earlyTransition += 7;

        earlyReasons.push(
          "MA20 상승"
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
      }

      if (freshGoldenCross) {
        earlyTransition += 12;

        earlyReasons.push(
          "MA20/MA60 신규 골든크로스"
        );
      } else if (
        ma20 >= ma60 &&
        ma20To60Gap <= 5
      ) {
        earlyTransition += 7;
      }

      if (freshAlignment) {
        earlyTransition += 8;

        earlyReasons.push(
          "정배열 신규 형성"
        );
      }

      earlyTransition =
        clamp(
          earlyTransition,
          0,
          30
        );

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
      }

      if (valueRatio >= 2) {
        earlyActivity += 15;

        earlyReasons.push(
          "거래대금 강한 유입"
        );
      } else if (
        valueRatio >= 1.5
      ) {
        earlyActivity += 12;
      } else if (
        valueRatio >= 1.2
      ) {
        earlyActivity += 8;
      }

      if (volumeRatio >= 1.8) {
        earlyActivity += 10;
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
        nearBreakout ||
        breakout20
      ) {
        earlyPosition += 5;

        earlyReasons.push(
          breakout20
            ? "20일 고점 돌파"
            : "20일 고점 돌파 대기"
        );
      }

      if (return5 >= 20) {
        earlyPenalty += 12;

        earlyWarnings.push(
          "단기 급등"
        );
      }

      if (return20 >= 35) {
        earlyPenalty += 12;

        earlyWarnings.push(
          "20일 상승폭 과대"
        );
      }

      if (distance20 >= 18) {
        earlyPenalty += 10;

        earlyWarnings.push(
          "MA20 과이격"
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
         EXHAUSTION
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
          "장기 강세 후 최근 약화"
        );
      }

      if (distance20 >= 25) {
        exhaustionExtension += 25;

        exhaustionReasons.push(
          "MA20 극단적 과이격"
        );
      } else if (
        distance20 >= 18
      ) {
        exhaustionExtension += 18;

        exhaustionReasons.push(
          "MA20 높은 과이격"
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
          "대량 거래에도 가격 정체"
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
      }

      if (close < ma20) {
        exhaustionTrend += 17;

        exhaustionReasons.push(
          "MA20 이탈"
        );
      }

      if (
        ma5 < ma20 &&
        return60 > 15
      ) {
        exhaustionTrend += 10;
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
         ENTRY
         -----------------------------------------------------
         가장 중요한 부분.

         강한 주식이 아니라
         "공세가 막 시작되는 자리"를 찾는다.
      ===================================================== */

      let entryTrend = 0;
      let entrySetup = 0;
      let entryBreakout = 0;
      let entryActivity = 0;
      let entryPenalty = 0;

      const entryReasons = [];
      const entryWarnings = [];

      /* -------------------------------------------------------
         A. 추세 기반 25
      ------------------------------------------------------- */

      if (close > ma20) {
        entryTrend += 5;
      }

      if (close > ma60) {
        entryTrend += 5;
      }

      if (ma5 > ma20) {
        entryTrend += 5;
      }

      if (ma20Rising) {
        entryTrend += 5;
      }

      if (ma60Rising) {
        entryTrend += 5;
      }

      if (entryTrend >= 20) {
        entryReasons.push(
          "상승 추세 기반 양호"
        );
      }

      /* -------------------------------------------------------
         B. 공세 시작 SETUP 30

         이미 오래 정배열인 것보다
         새로 만들어지는 정배열을 우선.
      ------------------------------------------------------- */

      if (freshGoldenCross) {
        entrySetup += 12;

        entryReasons.push(
          "MA20/MA60 신규 골든크로스"
        );
      } else if (
        ma20To60Gap >= -2 &&
        ma20To60Gap < 0
      ) {
        entrySetup += 9;

        entryReasons.push(
          "MA20/MA60 골든크로스 임박"
        );
      } else if (
        ma20 >= ma60 &&
        ma20To60Gap <= 4
      ) {
        entrySetup += 6;

        entryReasons.push(
          "MA20/MA60 초기 정배열"
        );
      }

      if (freshAlignment) {
        entrySetup += 10;

        entryReasons.push(
          "정배열 신규 형성"
        );
      } else if (
        alignment &&
        ma20To60Gap <= 5
      ) {
        entrySetup += 6;
      }

      /*
        가격이 MA20 근처에서
        공세 시작하는 자리를 선호
      */

      if (
        distance20 >= 0 &&
        distance20 <= 4
      ) {
        entrySetup += 8;

        entryReasons.push(
          "MA20 이격 부담 낮음"
        );
      } else if (
        distance20 > 4 &&
        distance20 <= 8
      ) {
        entrySetup += 5;
      } else if (
        distance20 > 8 &&
        distance20 <= 12
      ) {
        entrySetup += 2;
      }

      entrySetup =
        clamp(
          entrySetup,
          0,
          30
        );

      /* -------------------------------------------------------
         C. 돌파 20
      ------------------------------------------------------- */

      if (breakout20) {
        entryBreakout += 12;

        entryReasons.push(
          "20일 고점 돌파"
        );
      } else if (nearBreakout) {
        entryBreakout += 8;

        entryReasons.push(
          "20일 고점 돌파 직전"
        );
      }

      if (
        return5 > 0 &&
        return5 <= 8
      ) {
        entryBreakout += 4;
      }

      if (
        return10 > 0 &&
        return10 <= 15
      ) {
        entryBreakout += 4;
      }

      entryBreakout =
        clamp(
          entryBreakout,
          0,
          20
        );

      /* -------------------------------------------------------
         D. 거래 에너지 25
      ------------------------------------------------------- */

      if (valueRatio >= 2) {
        entryActivity += 15;

        entryReasons.push(
          "거래대금 강한 유입"
        );
      } else if (
        valueRatio >= 1.5
      ) {
        entryActivity += 12;

        entryReasons.push(
          "거래대금 증가"
        );
      } else if (
        valueRatio >= 1.2
      ) {
        entryActivity += 8;
      } else if (
        valueRatio >= 1
      ) {
        entryActivity += 4;
      }

      if (volumeRatio >= 1.8) {
        entryActivity += 10;

        entryReasons.push(
          "거래량 강한 확장"
        );
      } else if (
        volumeRatio >= 1.5
      ) {
        entryActivity += 8;
      } else if (
        volumeRatio >= 1.2
      ) {
        entryActivity += 5;
      }

      entryActivity =
        clamp(
          entryActivity,
          0,
          25
        );

      /* -------------------------------------------------------
         E. 추격매수 / 과열 / 소진 감점
      ------------------------------------------------------- */

      if (return5 >= 20) {
        entryPenalty += 20;

        entryWarnings.push(
          "5일 급등 - 추격 위험"
        );
      } else if (
        return5 >= 15
      ) {
        entryPenalty += 12;

        entryWarnings.push(
          "최근 단기 급등"
        );
      } else if (
        return5 >= 10
      ) {
        entryPenalty += 5;
      }

      if (return20 >= 40) {
        entryPenalty += 18;

        entryWarnings.push(
          "20일 상승폭 과대"
        );
      } else if (
        return20 >= 30
      ) {
        entryPenalty += 10;
      }

      if (distance20 >= 20) {
        entryPenalty += 20;

        entryWarnings.push(
          "MA20 극단적 과이격"
        );
      } else if (
        distance20 >= 15
      ) {
        entryPenalty += 12;

        entryWarnings.push(
          "MA20 과이격"
        );
      } else if (
        distance20 >= 12
      ) {
        entryPenalty += 5;
      }

      /*
        공세 소멸 위험은
        ENTRY에 강하게 반영
      */

      if (exhaustionScore >= 75) {
        entryPenalty += 50;

        entryWarnings.push(
          "공세 소멸 위험 매우 높음"
        );
      } else if (
        exhaustionScore >= 50
      ) {
        entryPenalty += 25;

        entryWarnings.push(
          "공세 소멸 위험 상승"
        );
      } else if (
        exhaustionScore >= 25
      ) {
        entryPenalty += 10;
      }

      /*
        이미 오래 정배열이고
        상승폭까지 큰 경우

        "좋은 주식"일 수는 있지만
        신규 ENTRY 초입은 아니다.
      */

      if (
        alignment &&
        alignment5DaysAgo &&
        return20 >= 20 &&
        distance20 >= 8
      ) {
        entryPenalty += 8;

        entryWarnings.push(
          "기존 상승 추세 진행 중 - 초입 매력 감소"
        );
      }

      let entryScore =
        entryTrend +
        entrySetup +
        entryBreakout +
        entryActivity -
        entryPenalty;

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
        earlyScore >= 70 ||
        freshGoldenCross ||
        freshAlignment
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

        code,

        name:
          latest.name ||
          candidate.name,

        market:
          latest.market,

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

        collectedDays:
          newestFirst.length,

        stage,

        entryStatus,

        blocked:
          exhaustionScore >= 75,

        scores: {
          leader:
            leaderScore,

          early:
            earlyScore,

          exhaustion:
            exhaustionScore,

          entry:
            entryScore
        },

        scoreDetail: {
          entry: {
            trend:
              entryTrend,

            setup:
              entrySetup,

            breakout:
              entryBreakout,

            activity:
              entryActivity,

            penalty:
              -entryPenalty
          }
        },

        signals: {
          alignment,

          freshAlignment,

          freshGoldenCross,

          ma20Rising,

          ma60Rising,

          ma20To60Gap:
            Number(
              ma20To60Gap.toFixed(
                2
              )
            ),

          distance20:
            Number(
              distance20.toFixed(
                2
              )
            ),

          distance60:
            Number(
              distance60.toFixed(
                2
              )
            ),

          return5:
            Number(
              return5.toFixed(
                2
              )
            ),

          return10:
            Number(
              return10.toFixed(
                2
              )
            ),

          return20:
            Number(
              return20.toFixed(
                2
              )
            ),

          return60:
            Number(
              return60.toFixed(
                2
              )
            ),

          volumeRatio:
            Number(
              volumeRatio.toFixed(
                2
              )
            ),

          tradingValueRatio:
            Number(
              valueRatio.toFixed(
                2
              )
            ),

          breakout20,

          nearBreakout
        },

        reasons: {
          leader:
            leaderReasons.slice(
              0,
              4
            ),

          early:
            earlyReasons.slice(
              0,
              4
            ),

          entry:
            entryReasons.slice(
              0,
              5
            ),

          exhaustion:
            exhaustionReasons.slice(
              0,
              4
            )
        },

        warnings: {
          leader:
            leaderWarnings.slice(
              0,
              3
            ),

          early:
            earlyWarnings.slice(
              0,
              3
            ),

          entry:
            entryWarnings.slice(
              0,
              4
            )
        }
      };
    }

    /* =========================================================
       4. ANALYZE + AUTO REFILL
    ========================================================= */

    const analyzed = [];
    const skipped = [];

    for (
      const candidate of candidates
    ) {
      if (
        analyzed.length >=
        limit
      ) {
        break;
      }

      const history =
        histories.get(
          String(
            candidate.code
          )
        ) || [];

      if (
        history.length <
        MIN_ANALYSIS_DAYS
      ) {
        skipped.push({
          code:
            String(
              candidate.code
            ),

          name:
            candidate.name,

          reason:
            `history 부족 (${history.length}일)`
        });

        continue;
      }

      const result =
        analyzeStock(
          candidate,
          history
        );

      if (result.ok) {
        analyzed.push(
          result
        );
      } else {
        skipped.push({
          code:
            result.code,

          name:
            result.name,

          reason:
            result.error
        });
      }
    }

    /* =========================================================
       BUYABLE
    ========================================================= */

    const buyable =
      analyzed.filter(
        stock => {
          if (stock.blocked) {
            return false;
          }

          if (
            stock.scores.exhaustion >=
            75
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
       FINAL RANKINGS
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
              b.scores.early -
              a.scores.early
            );
          }
        )
        .slice(0, 15);

    const leaderRanking =
      [...analyzed]
        .filter(
          stock =>
            !stock.blocked &&
            stock.scores.exhaustion <
              75
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
        .slice(0, 15);

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
        .slice(0, 15);

    const exhaustionRanking =
      [...analyzed]
        .filter(
          stock =>
            stock.scores.exhaustion >=
            25
        )
        .sort(
          (a, b) =>
            b.scores.exhaustion -
            a.scores.exhaustion
        )
        .slice(0, 15);

    /* =========================================================
       RESPONSE
    ========================================================= */

    return res.status(200).json({
      ok: true,

      version:
        "LEADER_CYCLE_RANKINGS_V7",

      date:
        scan.date || null,

      philosophy: {
        leader:
          "현재 시장을 실제로 이끄는 종목",

        early:
          "차기 주도주로 전환될 가능성이 높은 종목",

        exhaustion:
          "기존 공세의 상승 에너지가 소진되는 위험",

        entry:
          "정배열 형성·돌파·거래에너지가 동시에 나타나는 공세 시작 구간"
      },

      performance: {
        elapsedMs:
          Date.now() -
          startedAt,

        architecture:
          "BULK_KRX_HISTORY",

        stockDetailCalls: 0,

        marketHistoryCalls: 0,

        krxRequests,

        requestedCandidates:
          limit,

        scanCandidates:
          candidates.length,

        usableCandidates:
          analyzed.length,

        skippedCandidates:
          skipped.length
      },

      stats: {
        marketStocks:
          num(
            scan.market
              ?.totalStocks
          ),

        investableStocks:
          num(
            scan.market
              ?.investableStocks
          ),

        discoveryCandidates:
          candidates.length,

        target:
          limit,

        analyzed:
          analyzed.length,

        skipped:
          skipped.length,

        buyable:
          buyable.length
      },

      scoreGuide: {
        discovery:
          "정밀분석 대상을 찾기 위한 1차 시장 탐색 점수",

        leader:
          "현재 실제 주도주로서 추세·정배열·모멘텀·거래활동·지속성을 평가",

        early:
          "차기 주도주로 넘어가는 초기 전환·거래에너지·가격 위치를 평가",

        exhaustion:
          "공세 소멸 및 추세 종료 위험. 높을수록 위험",

        entry:
          "단순 강도가 아니라 정배열 신규 형성·골든크로스·돌파·거래에너지와 낮은 과열도를 이용해 공세 시작 위치를 평가"
      },

      topPicks: {
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
      },

      entryRanking,

      leaderRanking,

      earlyRanking,

      exhaustionRanking,

      failed: [],

      skipped
    });

  } catch (error) {
    console.error(
      "RANKINGS V7 ERROR",
      error
    );

    return res.status(500).json({
      ok: false,

      version:
        "LEADER_CYCLE_RANKINGS_V7",

      elapsedMs:
        Date.now() -
        startedAt,

      error:
        String(
          error?.message ||
          error
        )
    });
  }
};
