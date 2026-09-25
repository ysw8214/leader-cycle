module.exports = async function handler(req, res) {
  const startedAt = Date.now();

  try {
    /* ==========================================
       LEADER CYCLE - FAST MARKET SCANNER V2

       핵심 변경

       1. market-snapshot의 실제 거래일을 사용
       2. 요청일과 실제 거래일을 구분
       3. snapshot이 fallback한 날짜를 그대로 계승
       4. 중복 날짜 탐색 최소화
       5. 기존 discoveryScore 로직 유지
       6. rankings 호환 유지
    ========================================== */

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

      const n =
        Number(
          String(value)
            .replace(/,/g, "")
            .trim()
        );

      return Number.isFinite(n)
        ? n
        : 0;
    }

    function clamp(
      value,
      min,
      max
    ) {
      return Math.max(
        min,
        Math.min(
          max,
          value
        )
      );
    }

    function normalizeDate(
      value
    ) {
      return String(
        value || ""
      )
        .replace(/-/g, "")
        .trim();
    }

    function getKoreaDate() {
      const formatter =
        new Intl.DateTimeFormat(
          "en-CA",
          {
            timeZone:
              "Asia/Seoul",

            year:
              "numeric",

            month:
              "2-digit",

            day:
              "2-digit"
          }
        );

      const parts =
        formatter.formatToParts(
          new Date()
        );

      const values = {};

      for (
        const part of parts
      ) {
        if (
          part.type !==
          "literal"
        ) {
          values[
            part.type
          ] =
            part.value;
        }
      }

      return (
        `${values.year}` +
        `${values.month}` +
        `${values.day}`
      );
    }

    /* ==========================================
       REQUEST OPTIONS
    ========================================== */

    const requestedDate =
      normalizeDate(
        req.query.date
      );

    if (
      requestedDate &&
      !/^\d{8}$/.test(
        requestedDate
      )
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "date는 YYYYMMDD 형식이어야 합니다."
      });
    }

    const requestedLimit =
      parseInt(
        req.query.limit || "30",
        10
      );

    const limit =
      clamp(
        Number.isFinite(
          requestedLimit
        )
          ? requestedLimit
          : 30,
        10,
        100
      );

    /* ==========================================
       MARKET SNAPSHOT

       중요:

       market-snapshot V2가 이미

       요청일
         ↓
       데이터 없음
         ↓
       이전 날짜 자동 fallback

       을 처리한다.

       따라서 여기서 다시 날짜를
       10일 반복 탐색할 필요가 없다.
    ========================================== */

    const snapshotRequestDate =
      requestedDate ||
      getKoreaDate();

    const snapshotUrl =
      `${baseUrl}` +
      `/api/market-snapshot` +
      `?date=${encodeURIComponent(
        snapshotRequestDate
      )}`;

    let snapshotResponse;

    try {
      snapshotResponse =
        await fetch(
          snapshotUrl
        );
    } catch (error) {
      return res.status(502).json({
        ok: false,

        version:
          "FAST_SCAN_V2",

        error:
          "market-snapshot 호출 실패",

        detail:
          String(
            error?.message ||
            error
          )
      });
    }

    let snapshot;

    try {
      snapshot =
        await snapshotResponse.json();
    } catch {
      return res.status(502).json({
        ok: false,

        version:
          "FAST_SCAN_V2",

        error:
          "market-snapshot 응답을 읽지 못했습니다."
      });
    }

    if (
      !snapshotResponse.ok ||
      !snapshot ||
      !snapshot.ok ||
      !Array.isArray(
        snapshot.stocks
      ) ||
      snapshot.stocks.length === 0
    ) {
      return res.status(
        snapshotResponse.status ||
        502
      ).json({
        ok: false,

        version:
          "FAST_SCAN_V2",

        error:
          "최근 시장 데이터를 찾지 못했습니다.",

        detail:
          snapshot || null
      });
    }

    /* ==========================================
       ★ 실제 사용 날짜

       이전 코드 문제:

       usedDate = requestedDate

       로 강제 지정해서

       9/25 요청
       ↓
       snapshot 실제 데이터 9/23
       ↓
       market-scan은 9/25라고 표시

       되는 문제가 있었다.

       이제 snapshot.date를 사용한다.
    ========================================== */

    const usedDate =
      normalizeDate(
        snapshot.date
      );

    if (
      !/^\d{8}$/.test(
        usedDate
      )
    ) {
      return res.status(502).json({
        ok: false,

        version:
          "FAST_SCAN_V2",

        error:
          "market-snapshot 실제 거래일을 확인할 수 없습니다.",

        snapshotDate:
          snapshot.date || null
      });
    }

    const fallbackUsed =
      usedDate !==
      snapshotRequestDate;

    /* ==========================================
       기본 데이터 정리
    ========================================== */

    const allStocks =
      snapshot.stocks
        .map(stock => ({
          code:
            String(
              stock.code || ""
            ).trim(),

          name:
            String(
              stock.name || ""
            ).trim(),

          market:
            String(
              stock.market || ""
            ).trim(),

          close:
            num(
              stock.close
            ),

          changeRate:
            num(
              stock.changeRate
            ),

          volume:
            num(
              stock.volume
            ),

          tradingValue:
            num(
              stock.tradingValue
            ),

          marketCap:
            num(
              stock.marketCap
            )
        }))
        .filter(stock =>
          /^\d{6}$/.test(
            stock.code
          ) &&
          stock.close > 0
        );

    /* ==========================================
       INVESTABLE FILTER

       기존 기준 유지

       시총 1,000억원 이상
       거래대금 30억원 이상
    ========================================== */

    const MIN_MARKET_CAP =
      100000000000;

    const MIN_TRADING_VALUE =
      3000000000;

    const investable =
      allStocks.filter(
        stock =>
          stock.marketCap >=
            MIN_MARKET_CAP &&
          stock.tradingValue >=
            MIN_TRADING_VALUE
      );

    /* ==========================================
       시장 상대 순위
    ========================================== */

    const valueSorted =
      [...investable]
        .sort(
          (a, b) =>
            b.tradingValue -
            a.tradingValue
        );

    const changeSorted =
      [...investable]
        .sort(
          (a, b) =>
            b.changeRate -
            a.changeRate
        );

    const valueRank =
      new Map();

    const changeRank =
      new Map();

    valueSorted.forEach(
      (
        stock,
        index
      ) => {
        valueRank.set(
          stock.code,
          index
        );
      }
    );

    changeSorted.forEach(
      (
        stock,
        index
      ) => {
        changeRank.set(
          stock.code,
          index
        );
      }
    );

    const total =
      Math.max(
        investable.length,
        1
      );

    /* ==========================================
       DISCOVERY SCORE

       거래대금 상대강도 45
       당일 가격강도     25
       절대 유동성       20
       시가총액 안정성   10
    ========================================== */

    const candidates =
      investable.map(
        stock => {
          /* ------------------------------
             거래대금 상대강도
          ------------------------------ */

          const vr =
            valueRank.get(
              stock.code
            ) ?? total;

          const valuePercentile =
            1 -
            vr / total;

          const valueScore =
            clamp(
              valuePercentile *
                45,
              0,
              45
            );

          /* ------------------------------
             가격 강도
          ------------------------------ */

          let priceScore = 0;

          if (
            stock.changeRate >= 2 &&
            stock.changeRate < 5
          ) {
            priceScore = 15;
          }

          else if (
            stock.changeRate >= 5 &&
            stock.changeRate < 10
          ) {
            priceScore = 21;
          }

          else if (
            stock.changeRate >= 10 &&
            stock.changeRate < 20
          ) {
            priceScore = 25;
          }

          else if (
            stock.changeRate >= 0 &&
            stock.changeRate < 2
          ) {
            priceScore = 8;
          }

          else if (
            stock.changeRate >= 20
          ) {
            priceScore = 20;
          }

          else if (
            stock.changeRate > -2
          ) {
            priceScore = 3;
          }

          /* ------------------------------
             절대 거래대금
          ------------------------------ */

          let liquidityScore = 0;

          if (
            stock.tradingValue >=
            500000000000
          ) {
            liquidityScore = 20;
          }

          else if (
            stock.tradingValue >=
            200000000000
          ) {
            liquidityScore = 17;
          }

          else if (
            stock.tradingValue >=
            100000000000
          ) {
            liquidityScore = 14;
          }

          else if (
            stock.tradingValue >=
            50000000000
          ) {
            liquidityScore = 11;
          }

          else if (
            stock.tradingValue >=
            20000000000
          ) {
            liquidityScore = 8;
          }

          else if (
            stock.tradingValue >=
            10000000000
          ) {
            liquidityScore = 5;
          }

          else {
            liquidityScore = 2;
          }

          /* ------------------------------
             시가총액
          ------------------------------ */

          let capScore = 0;

          if (
            stock.marketCap >=
            10000000000000
          ) {
            capScore = 10;
          }

          else if (
            stock.marketCap >=
            5000000000000
          ) {
            capScore = 9;
          }

          else if (
            stock.marketCap >=
            1000000000000
          ) {
            capScore = 7;
          }

          else if (
            stock.marketCap >=
            500000000000
          ) {
            capScore = 5;
          }

          else {
            capScore = 3;
          }

          const discoveryScore =
            Math.round(
              valueScore +
              priceScore +
              liquidityScore +
              capScore
            );

          const cr =
            changeRank.get(
              stock.code
            ) ?? total;

          const reasons = [];

          if (
            valuePercentile >=
            0.95
          ) {
            reasons.push(
              "시장 거래대금 상위 5%"
            );
          }

          else if (
            valuePercentile >=
            0.9
          ) {
            reasons.push(
              "시장 거래대금 상위 10%"
            );
          }

          if (
            stock.changeRate >=
            5
          ) {
            reasons.push(
              "강한 가격 모멘텀"
            );
          }

          if (
            stock.tradingValue >=
            100000000000
          ) {
            reasons.push(
              "1,000억원 이상 거래대금"
            );
          }

          return {
            code:
              stock.code,

            name:
              stock.name,

            market:
              stock.market ||
              null,

            discoveryScore,

            changeRate:
              stock.changeRate,

            close:
              stock.close,

            tradingValue:
              stock.tradingValue,

            marketCap:
              stock.marketCap,

            marketRanks: {
              tradingValue:
                vr + 1,

              change:
                cr + 1
            },

            reasons
          };
        }
      );

    /* ==========================================
       후보 정렬
    ========================================== */

    const selected =
      candidates
        .sort(
          (a, b) => {
            if (
              b.discoveryScore !==
              a.discoveryScore
            ) {
              return (
                b.discoveryScore -
                a.discoveryScore
              );
            }

            return (
              b.tradingValue -
              a.tradingValue
            );
          }
        )
        .slice(
          0,
          limit
        );

    /* ==========================================
       CACHE
    ========================================== */

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=1800, stale-while-revalidate=3600"
    );

    /* ==========================================
       RESPONSE
    ========================================== */

    return res.status(200).json({
      ok: true,

      version:
        "FAST_SCAN_V2",

      /*
        ★ 실제 KRX 거래일
      */
      date:
        usedDate,

      /*
        사용자가 원래 요청한 날짜
        또는 오늘 한국 날짜
      */
      requestedDate:
        snapshotRequestDate,

      /*
        실제 거래일로 fallback했는지
      */
      fallbackUsed,

      snapshot: {
        version:
          snapshot.version ||
          null,

        requestedDate:
          snapshot.requestedDate ||
          snapshotRequestDate,

        actualDate:
          usedDate,

        fallbackUsed:
          Boolean(
            snapshot.fallbackUsed
          ),

        partial:
          Boolean(
            snapshot.partial
          )
      },

      market: {
        totalStocks:
          allStocks.length,

        investableStocks:
          investable.length,

        candidateStocks:
          candidates.length,

        returned:
          selected.length
      },

      filter: {
        minMarketCap:
          MIN_MARKET_CAP,

        minTradingValue:
          MIN_TRADING_VALUE
      },

      scoreGuide: {
        discovery:
          "전체 시장에서 정밀 분석할 종목을 고르는 1차 후보 점수",

        leader:
          "현재 실제 주도주인지 평가",

        early:
          "차기 주도주로 전환되는 초입인지 평가",

        entry:
          "현재 가격에서 신규 매수하기 좋은 위치인지 평가",

        exhaustion:
          "공세 소멸 및 추세 종료 위험. 높을수록 위험"
      },

      performance: {
        elapsedMs:
          Date.now() -
          startedAt,

        architecture:
          "SNAPSHOT_SINGLE_CALL",

        snapshotAttempts:
          num(
            snapshot.performance
              ?.attempts
          )
      },

      candidates:
        selected
    });

  } catch (error) {
    console.error(
      "MARKET SCAN V2 ERROR",
      error
    );

    return res.status(500).json({
      ok: false,

      version:
        "FAST_SCAN_V2",

      error:
        String(
          error?.message ||
          error
        ),

      elapsedMs:
        Date.now() -
        startedAt
    });
  }
};
