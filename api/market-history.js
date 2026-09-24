module.exports = async function handler(req, res) {
  try {
    /* ==========================================
       LEADER CYCLE - MARKET HISTORY V3 FAST

       핵심 변경점

       기존:
       market-history
         → market-snapshot
           → KRX KOSPI + KOSDAQ

       변경:
       market-history
         → KRX 직접 호출

       추가:
       1. 종목 시장 자동 판별
       2. 이후 해당 시장만 조회
       3. 날짜 병렬 조회
       4. stock-detail 호환 유지
    ========================================== */

    const code =
      String(req.query.code || "").trim();

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        ok: false,
        error: "6자리 종목코드(code)가 필요합니다."
      });
    }

    const apiKey =
      process.env.KRX_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "KRX_API_KEY 환경변수가 없습니다."
      });
    }

    const requestedDays =
      parseInt(
        req.query.days || "100",
        10
      );

    const wantedDays =
      Math.min(
        Math.max(
          Number.isFinite(requestedDays)
            ? requestedDays
            : 100,
          60
        ),
        120
      );

    /* ==========================================
       CACHE

       과거 데이터는 거의 변하지 않으므로
       강하게 캐시
    ========================================== */

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=21600, stale-while-revalidate=86400"
    );

    /* ==========================================
       HELPERS
    ========================================== */

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

    function normalizeCode(value) {
      const raw =
        String(value || "").trim();

      /*
        KRX ISU_CD가 단축코드가 아닌
        형태로 오는 경우도 대비
      */

      if (/^\d{6}$/.test(raw)) {
        return raw;
      }

      const match =
        raw.match(/(\d{6})/);

      return match
        ? match[1]
        : raw;
    }

    /* ==========================================
       날짜 기준

       date 지정 가능

       예:
       ?code=005930&days=100&date=20260923

       rankings와 날짜 일치시킬 수 있음
    ========================================== */

    const requestedDate =
      String(
        req.query.date || ""
      ).trim();

    let baseDate;

    if (
      /^\d{8}$/.test(requestedDate)
    ) {
      const y =
        Number(
          requestedDate.slice(0, 4)
        );

      const m =
        Number(
          requestedDate.slice(4, 6)
        );

      const d =
        Number(
          requestedDate.slice(6, 8)
        );

      baseDate =
        new Date(
          y,
          m - 1,
          d
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

    /* ==========================================
       후보 날짜

       100 거래일이면
       약 145~155 달력일이면 충분하지만

       공휴일 여유 포함해서
       최대 180일 생성
    ========================================== */

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

      // 토요일 / 일요일 제외
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

    /* ==========================================
       KRX ENDPOINT
    ========================================== */

    const KOSPI_URL =
      "https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd";

    const KOSDAQ_URL =
      "https://data-dbg.krx.co.kr/svc/apis/sto/ksq_bydd_trd";

    /* ==========================================
       KRX FETCH
    ========================================== */

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
        const response =
          await fetch(
            url,
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
            status:
              response.status,
            rows: []
          };
        }

        const json =
          await response.json();

        const rows =
          Array.isArray(
            json.OutBlock_1
          )
            ? json.OutBlock_1
            : [];

        return {
          ok: true,
          date,
          market,
          status:
            response.status,
          rows
        };

      } catch (error) {
        return {
          ok: false,
          date,
          market,
          status: 0,
          rows: [],
          error:
            String(
              error?.message ||
              error
            )
        };
      }
    }

    /* ==========================================
       종목 찾기
    ========================================== */

    function findStock(
      rows
    ) {
      if (!Array.isArray(rows)) {
        return null;
      }

      return (
        rows.find(row => {
          const rowCode =
            normalizeCode(
              row.ISU_CD
            );

          return (
            rowCode === code
          );
        }) ||
        null
      );
    }

    /* ==========================================
       ROW 변환
    ========================================== */

    function convertRow(
      row,
      market
    ) {
      if (!row) {
        return null;
      }

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

    /* ==========================================
       1. MARKET DETECTION

       최신 거래일을 탐색하면서

       KOSPI / KOSDAQ을 동시에 확인하는 건
       최초 시장 판별 때만 수행.

       시장을 찾은 이후에는
       해당 시장 API만 사용.
    ========================================== */

    let detectedMarket =
      null;

    let firstRecord =
      null;

    let detectionDate =
      null;

    /*
      최근 영업일 후보 최대 10개만 검사
    */

    const detectionDates =
      candidateDates.slice(
        0,
        10
      );

    for (
      const date of detectionDates
    ) {
      const [
        kospi,
        kosdaq
      ] =
        await Promise.all([
          fetchMarket(
            date,
            "KOSPI"
          ),

          fetchMarket(
            date,
            "KOSDAQ"
          )
        ]);

      const kospiRow =
        findStock(
          kospi.rows
        );

      if (kospiRow) {
        detectedMarket =
          "KOSPI";

        firstRecord =
          convertRow(
            kospiRow,
            "KOSPI"
          );

        detectionDate =
          date;

        break;
      }

      const kosdaqRow =
        findStock(
          kosdaq.rows
        );

      if (kosdaqRow) {
        detectedMarket =
          "KOSDAQ";

        firstRecord =
          convertRow(
            kosdaqRow,
            "KOSDAQ"
          );

        detectionDate =
          date;

        break;
      }
    }

    if (
      !detectedMarket ||
      !firstRecord
    ) {
      return res.status(404).json({
        ok: false,
        code,
        error:
          "KRX KOSPI/KOSDAQ에서 종목을 찾지 못했습니다."
      });
    }

    /* ==========================================
       2. HISTORY 수집

       여기부터는

       삼성전자 → KOSPI만
       알테오젠 → KOSDAQ만

       조회

       즉 기존 대비 KRX 호출량 감소
    ========================================== */

    const records =
      [firstRecord];

    const seenDates =
      new Set([
        firstRecord.date
      ]);

    /*
      이미 시장 판별에 사용한 최신 날짜부터
      다시 시작하되 중복은 Set으로 제거
    */

    const startIndex =
      Math.max(
        candidateDates.indexOf(
          detectionDate
        ),
        0
      );

    const remainingDates =
      candidateDates.slice(
        startIndex
      );

    /*
      한 번에 12거래일 병렬

      20보다 낮춰 KRX/Vercel 부담 감소
      5보다 높여 rankings 속도 확보
    */

    const batchSize = 12;

    for (
      let i = 0;
      i < remainingDates.length &&
      records.length < wantedDays;
      i += batchSize
    ) {
      const batch =
        remainingDates.slice(
          i,
          i + batchSize
        );

      const results =
        await Promise.all(
          batch.map(date =>
            fetchMarket(
              date,
              detectedMarket
            )
          )
        );

      for (
        const result of results
      ) {
        if (
          !result ||
          !result.ok
        ) {
          continue;
        }

        const row =
          findStock(
            result.rows
          );

        if (!row) {
          continue;
        }

        const converted =
          convertRow(
            row,
            detectedMarket
          );

        if (
          !converted ||
          !converted.date ||
          converted.close <= 0
        ) {
          continue;
        }

        if (
          seenDates.has(
            converted.date
          )
        ) {
          continue;
        }

        seenDates.add(
          converted.date
        );

        records.push(
          converted
        );

        if (
          records.length >=
          wantedDays
        ) {
          break;
        }
      }
    }

    /* ==========================================
       최신 → 과거 정렬
    ========================================== */

    records.sort(
      (a, b) =>
        b.date.localeCompare(
          a.date
        )
    );

    const selected =
      records.slice(
        0,
        wantedDays
      );

    if (
      selected.length < 60
    ) {
      return res.status(422).json({
        ok: false,

        code,

        market:
          detectedMarket,

        error:
          "점수 계산에 필요한 최소 60거래일 데이터를 확보하지 못했습니다.",

        requestedDays:
          wantedDays,

        collectedDays:
          selected.length
      });
    }

    /* ==========================================
       MOVING AVERAGE

       selected:
       최신 → 과거
    ========================================== */

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

    /* ==========================================
       CHART
    ========================================== */

    const chart =
      selected.map(
        (row, index) => {
          return {
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
          };
        }
      );

    const latest =
      chart[0];

    /* ==========================================
       TREND
    ========================================== */

    const alignment =
      latest.ma5 !== null &&
      latest.ma20 !== null &&
      latest.ma60 !== null &&
      latest.close >
        latest.ma5 &&
      latest.ma5 >
        latest.ma20 &&
      latest.ma20 >
        latest.ma60;

    let ma20Rising =
      false;

    if (
      chart[0]?.ma20 != null &&
      chart[5]?.ma20 != null
    ) {
      ma20Rising =
        chart[0].ma20 >
        chart[5].ma20;
    }

    let ma60Rising =
      false;

    if (
      chart[0]?.ma60 != null &&
      chart[5]?.ma60 != null
    ) {
      ma60Rising =
        chart[0].ma60 >
        chart[5].ma60;
    }

    /* ==========================================
       RESPONSE

       stock-detail.js와 호환 유지
    ========================================== */

    return res.status(200).json({
      ok: true,

      version:
        "MARKET_HISTORY_V3_FAST",

      source:
        "KRX_DIRECT",

      code,

      name:
        latest.name,

      market:
        detectedMarket,

      requestedDays:
        wantedDays,

      collectedDays:
        selected.length,

      latestDate:
        latest.date,

      trend: {
        price:
          latest.close,

        ma5:
          latest.ma5,

        ma20:
          latest.ma20,

        ma60:
          latest.ma60,

        alignment,

        ma20Rising,

        ma60Rising,

        priceAbove20:
          latest.ma20 !== null
            ? latest.close >
              latest.ma20
            : false,

        priceAbove60:
          latest.ma60 !== null
            ? latest.close >
              latest.ma60
            : false
      },

      performance: {
        marketDetected:
          detectedMarket,

        directKrx:
          true,

        snapshotDependency:
          false,

        batchSize
      },

      chart
    });

  } catch (error) {
    console.error(
      "MARKET HISTORY V3 ERROR",
      error
    );

    return res.status(500).json({
      ok: false,

      version:
        "MARKET_HISTORY_V3_FAST",

      error:
        String(
          error?.message ||
          error
        )
    });
  }
};
