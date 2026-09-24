module.exports = async function handler(req, res) {
  const startedAt = Date.now();

  try {
    /* =========================================================
       LEADER CYCLE - RANKINGS V6.1 BULK AUTO REFILL

       핵심:
       1. market-scan에서 최종 목표보다 후보를 넉넉히 확보
       2. KRX 날짜별 데이터를 딱 한 번씩 호출
       3. 후보 전체 history를 동시에 수집
       4. history 부족 종목은 자동 SKIP
       5. 다음 순위 후보로 자동 보충
       6. 정상 분석 종목 limit개 확보
       7. stock-detail / market-history 반복 호출 없음
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

      return Number.isFinite(n) ? n : 0;
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

      if (!previous) return 0;

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
            signal:
              controller.signal
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
          status:
            response.status,
          json
        };

      } finally {
        clearTimeout(timer);
      }
    }

    /* =========================================================
       OPTIONS

       limit = 최종 정상 분석 목표

       예:
       limit=10
       → 최종 정상 분석 10종목 목표
       → scan에서는 최대 20종목 확보
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

    const scanLimit =
      clamp(
        limit * 2,
        limit,
        40
      );

    const requestedDate =
      String(
        req.query.date || ""
      ).trim();

    /* =========================================================
       1. MARKET SCAN

       최종 목표보다 넉넉하게 후보 확보
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
          8000
        );
    } catch (error) {
      return res.status(504).json({
        ok: false,
        version:
          "LEADER_CYCLE_RANKINGS_V6_1_AUTO_REFILL",
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
      !Array.isArray(scan.candidates)
    ) {
      return res.status(500).json({
        ok: false,
        version:
          "LEADER_CYCLE_RANKINGS_V6_1_AUTO_REFILL",
        error:
          "market-scan 호출 실패",
        detail: scan
      });
    }

    /*
      scan 순서를 그대로 유지.

      상위 후보가 history 부족이면
      다음 후보가 자동으로 보충된다.
    */

    const candidates =
      scan.candidates
        .slice(0, scanLimit);

    if (!candidates.length) {
      return res.status(200).json({
        ok: true,
        version:
          "LEADER_CYCLE_RANKINGS_V6_1_AUTO_REFILL",
        date:
          scan.date || null,
        stats: {
          target: limit,
          candidates: 0,
          analyzed: 0,
          skipped: 0,
          failed: 0,
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
        failed: [],
        skipped: []
      });
    }

    const candidateCodes =
      new Set(
        candidates.map(
          x => String(x.code)
        )
      );

    /* =========================================================
       기준 날짜

       market-scan이 실제 사용한 날짜를 그대로 사용
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
       날짜 후보

       100 거래일 확보용

       주말 제외 전 달력일 후보 생성.
       공휴일 여유 포함.
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
       KRX
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
                AUTH_KEY:
                  apiKey
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
          ok:
            result.ok,
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
       각 후보 기록 저장소

       code -> history[]
    ========================================================= */

    const histories =
      new Map();

    candidates.forEach(
      candidate => {
        histories.set(
          String(candidate.code),
          []
        );
      }
    );

    /* =========================================================
       ROW 변환
    ========================================================= */

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

       날짜 하나당
       KOSPI 1회 + KOSDAQ 1회.

       응답에서 후보 종목만 추출.

       종목별 API 반복 호출 없음.
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
      /*
        scan 순서 기준으로 history 60일 이상인
        후보를 찾는다.

        그중 최종 limit개가 모두 100일을
        확보했다면 더 이상 KRX를 조회하지 않는다.

        history가 짧은 신규 상장 종목 때문에
        전체 작업이 지연되는 것을 방지한다.
      */

      const usableCandidates =
        candidates.filter(
          candidate =>
            (
              histories.get(
                String(
                  candidate.code
                )
              ) || []
            ).length >=
            MIN_ANALYSIS_DAYS
        );

      const targetCandidates =
        usableCandidates.slice(
          0,
          limit
        );

      const enoughCandidates =
        targetCandidates.length >=
        limit;

      const targetComplete =
        enoughCandidates &&
        targetCandidates.every(
          candidate =>
            (
              histories.get(
                String(
                  candidate.code
                )
              ) || []
            ).length >=
            REQUIRED_DAYS
        );

      if (targetComplete) {
        break;
      }

      const batch =
        candidateDates.slice(
          i,
          i +
          DATE_BATCH_SIZE
        );

      const jobs = [];

      batch.forEach(
        date => {
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
      );

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

          /*
            100일까지 저장.
          */

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

          const duplicate =
            history.some(
              x =>
                x.date ===
                converted.date
            );

          if (!duplicate) {
            history.push(
              converted
            );
          }
        }
      }
    }

    /* =========================================================
       3. 종목별 분석
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

      /*
        최신 -> 과거 정렬
      */

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

      /*
        이동평균 계산
      */

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
            x => x.close
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

      /*
        과거 -> 최신
      */

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
         거래량 / 거래대금
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

      if (
        volumeRatio >= 1.5
      ) {
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

      if (
        volumeRatio >= 1.8
      ) {
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
          "장기 강세 이후 최근 모멘텀 약화"
        );
      }

      if (
        distance20 >= 25
      ) {
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
         ENTRY
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

      if (
        entryTrend >= 24
      ) {
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

      if (
        volumeRatio >= 1.5
      ) {
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

          breakout20
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
              4
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
              3
            )
        }
      };
    }

    /* =========================================================
       4. 후보 분석 + 자동 보충

       scan 순서대로 검사.

       history 60일 미만
       → SKIP

       정상 분석 성공
       → analyzed 추가

       analyzed가 limit개 되면 종료.
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

    /*
      history 부족은 시스템 장애가 아니다.
    */

    const failed = [];

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
       RANKINGS
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
        .slice(0, 15);

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
            stock.scores
              .exhaustion >= 25
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
        "LEADER_CYCLE_RANKINGS_V6_1_AUTO_REFILL",

      date:
        scan.date ||
        null,

      performance: {
        elapsedMs:
          Date.now() -
          startedAt,

        architecture:
          "BULK_KRX_HISTORY_AUTO_REFILL",

        stockDetailCalls:
          0,

        marketHistoryCalls:
          0,

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

        failed:
          failed.length,

        buyable:
          buyable.length
      },

      scoreGuide: {
        discovery:
          "정밀분석 대상을 찾기 위한 1차 시장 탐색 점수",

        leader:
          "현재 실제 주도주로서 추세·정배열·모멘텀·거래활동·지속성을 평가",

        early:
          "아직 과도하게 오르기 전 차기 주도주 전환 가능성을 평가",

        entry:
          "현재 가격에서 신규 매수하기 좋은 위치인지 평가",

        exhaustion:
          "공세 소멸 및 추세 종료 위험. 높을수록 신규매수에 불리"
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
      "RANKINGS V6.1 AUTO REFILL ERROR",
      error
    );

    return res.status(500).json({
      ok: false,

      version:
        "LEADER_CYCLE_RANKINGS_V6_1_AUTO_REFILL",

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
