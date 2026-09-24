module.exports = async function handler(req, res) {
  try {
    const code =
      String(
        req.query.code || "005930"
      ).trim();

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        ok: false,
        error:
          "6자리 종목코드(code)가 필요합니다."
      });
    }

    const wantedDays =
      Math.min(
        Math.max(
          parseInt(
            req.query.days || "100",
            10
          ),
          60
        ),
        120
      );

    const requestedDate =
      String(
        req.query.date || ""
      ).trim();

    if (
      requestedDate &&
      !/^\d{8}$/.test(requestedDate)
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "date는 YYYYMMDD 형식이어야 합니다."
      });
    }

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=1800, stale-while-revalidate=86400"
    );

    const protocol =
      req.headers["x-forwarded-proto"] ||
      "https";

    const host = req.headers.host;

    if (!host) {
      return res.status(500).json({
        ok: false,
        error:
          "host 정보를 확인할 수 없습니다."
      });
    }

    const baseUrl =
      `${protocol}://${host}`;

    function parseDate(value) {
      const y =
        Number(value.slice(0, 4));

      const m =
        Number(value.slice(4, 6));

      const d =
        Number(value.slice(6, 8));

      return new Date(
        y,
        m - 1,
        d,
        12,
        0,
        0
      );
    }

    function formatDate(date) {
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

    let baseDate;

    if (requestedDate) {
      baseDate =
        parseDate(requestedDate);
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

    const candidateDates = [];

    /*
      120 거래일 + 휴장일 여유.
      약 200 calendar days 탐색.
    */

    for (
      let i = 0;
      i < 200;
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
        formatDate(target)
      );
    }

    async function fetchSnapshot(date) {
      try {
        const url =
          `${baseUrl}/api/market-snapshot?date=${date}`;

        const response =
          await fetch(url);

        if (!response.ok) {
          return null;
        }

        const json =
          await response.json();

        if (
          !json.ok ||
          !Array.isArray(json.stocks) ||
          json.stocks.length === 0
        ) {
          return null;
        }

        const row =
          json.stocks.find(item =>
            String(
              item.code || ""
            ).trim() === code
          );

        if (!row) {
          return null;
        }

        const close =
          Number(row.close || 0);

        if (close <= 0) {
          return null;
        }

        return {
          date:
            String(
              row.date ||
              json.date ||
              date
            ),

          code,

          name:
            String(
              row.name || ""
            ),

          market:
            String(
              row.market || ""
            ),

          open:
            Number(
              row.open || 0
            ),

          high:
            Number(
              row.high || 0
            ),

          low:
            Number(
              row.low || 0
            ),

          close,

          changeRate:
            Number(
              row.changeRate || 0
            ),

          volume:
            Number(
              row.volume || 0
            ),

          tradingValue:
            Number(
              row.tradingValue || 0
            ),

          marketCap:
            Number(
              row.marketCap || 0
            )
        };

      } catch {
        return null;
      }
    }

    const records = [];

    /*
      20일씩 요청.
      snapshot CDN cache를 최대한 활용.
    */

    const batchSize = 20;

    for (
      let i = 0;
      i < candidateDates.length &&
      records.length < wantedDays;
      i += batchSize
    ) {
      const batch =
        candidateDates.slice(
          i,
          i + batchSize
        );

      const results =
        await Promise.all(
          batch.map(
            fetchSnapshot
          )
        );

      for (
        const result of results
      ) {
        if (result) {
          records.push(result);
        }

        if (
          records.length >=
          wantedDays
        ) {
          break;
        }
      }
    }

    records.sort(
      (a, b) =>
        String(b.date)
          .localeCompare(
            String(a.date)
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
        requestedDays:
          wantedDays,
        collectedDays:
          selected.length,
        error:
          "정밀분석에 필요한 60거래일 데이터를 확보하지 못했습니다."
      });
    }

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
        slice.length < period
      ) {
        return null;
      }

      const sum =
        slice.reduce(
          (total, row) =>
            total +
            Number(
              row.close || 0
            ),
          0
        );

      return sum / period;
    }

    const chart =
      selected.map(
        (row, index) => {
          const ma5 =
            movingAverage(
              index,
              5
            );

          const ma20 =
            movingAverage(
              index,
              20
            );

          const ma60 =
            movingAverage(
              index,
              60
            );

          return {
            ...row,

            ma5:
              ma5 === null
                ? null
                : Number(
                    ma5.toFixed(2)
                  ),

            ma20:
              ma20 === null
                ? null
                : Number(
                    ma20.toFixed(2)
                  ),

            ma60:
              ma60 === null
                ? null
                : Number(
                    ma60.toFixed(2)
                  )
          };
        }
      );

    const latest =
      chart[0];

    const alignment =
      latest.ma5 !== null &&
      latest.ma20 !== null &&
      latest.ma60 !== null &&
      latest.close > latest.ma5 &&
      latest.ma5 > latest.ma20 &&
      latest.ma20 > latest.ma60;

    const ma20Rising =
      chart[0]?.ma20 != null &&
      chart[5]?.ma20 != null
        ? chart[0].ma20 >
          chart[5].ma20
        : false;

    const ma60Rising =
      chart[0]?.ma60 != null &&
      chart[5]?.ma60 != null
        ? chart[0].ma60 >
          chart[5].ma60
        : false;

    return res.status(200).json({
      ok: true,

      source:
        "MARKET_SNAPSHOT",

      code,

      name:
        latest.name,

      market:
        latest.market,

      requestedDate:
        requestedDate || null,

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

      chart
    });

  } catch (error) {
    console.error(
      "MARKET HISTORY ERROR",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        String(
          error?.message ||
          error
        )
    });
  }
};
