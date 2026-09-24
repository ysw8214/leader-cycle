module.exports = async function handler(req, res) {
  try {
    /* ==========================================
       0. 기본 설정
    ========================================== */

    const apiKey = process.env.KRX_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "KRX_API_KEY가 없습니다."
      });
    }

    const code = String(
      req.query.code || "005930"
    ).trim();

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        ok: false,
        error: "6자리 종목코드(code)가 필요합니다."
      });
    }

    const wantedDays = Math.min(
      Math.max(
        parseInt(req.query.days || "100", 10),
        60
      ),
      120
    );

    /*
      캐시

      브라우저: 5분
      Vercel CDN: 30분
      stale 상태: 최대 24시간 재사용 가능

      KRX 일봉 데이터는 초단위 실시간 데이터가 아니므로
      매 클릭마다 다시 100일치를 받을 필요가 없음.
    */

    res.setHeader(
      "Cache-Control",
      "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400"
    );

    /* ==========================================
       1. 한국시간 기준 날짜 생성
    ========================================== */

    const now = new Date();

    const kstNow = new Date(
      now.toLocaleString("en-US", {
        timeZone: "Asia/Seoul"
      })
    );

    const candidateDates = [];

    /*
      최대 120거래일 확보용.
      휴장일을 고려해서 190일 후보 생성.
    */

    for (let i = 0; i < 190; i++) {
      const target = new Date(kstNow);

      target.setDate(
        kstNow.getDate() - i
      );

      const day = target.getDay();

      // 토/일 제외
      if (day === 0 || day === 6) {
        continue;
      }

      const yyyy =
        target.getFullYear();

      const mm =
        String(
          target.getMonth() + 1
        ).padStart(2, "0");

      const dd =
        String(
          target.getDate()
        ).padStart(2, "0");

      candidateDates.push(
        `${yyyy}${mm}${dd}`
      );
    }

    /* ==========================================
       2. 날짜별 KRX 조회
    ========================================== */

    async function fetchDay(date) {
      try {
        const url =
          "https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd" +
          `?basDd=${date}`;

        const response =
          await fetch(url, {
            method: "GET",

            headers: {
              AUTH_KEY: apiKey
            }
          });

        if (!response.ok) {
          return null;
        }

        const json =
          await response.json();

        if (
          !Array.isArray(
            json.OutBlock_1
          )
        ) {
          return null;
        }

        const row =
          json.OutBlock_1.find(
            item => {
              const shortCode =
                item.ISU_SRT_CD ||
                item.ISU_CD ||
                "";

              return (
                shortCode === code ||
                shortCode.endsWith(code)
              );
            }
          );

        if (!row) {
          return null;
        }

        return {
          date:
            row.BAS_DD,

          code:
            row.ISU_SRT_CD ||
            code,

          name:
            row.ISU_NM,

          open:
            Number(
              row.TDD_OPNPRC || 0
            ),

          high:
            Number(
              row.TDD_HGPRC || 0
            ),

          low:
            Number(
              row.TDD_LWPRC || 0
            ),

          close:
            Number(
              row.TDD_CLSPRC || 0
            ),

          changeRate:
            Number(
              row.FLUC_RT || 0
            ),

          volume:
            Number(
              row.ACC_TRDVOL || 0
            ),

          tradingValue:
            Number(
              row.ACC_TRDVAL || 0
            ),

          marketCap:
            Number(
              row.MKTCAP || 0
            )
        };

      } catch (error) {
        return null;
      }
    }

    /* ==========================================
       3. 병렬 수집
    ========================================== */

    const records = [];

    /*
      기존 10개 → 20개 동시 요청.

      너무 과도한 동시 호출은 피하면서
      왕복 횟수를 줄인다.
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
          batch.map(fetchDay)
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

    /* ==========================================
       4. 날짜 정렬
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
      return res.status(404).json({
        ok: false,

        code,

        error:
          "60거래일 이상의 데이터를 확보하지 못했습니다.",

        collectedDays:
          selected.length
      });
    }

    /* ==========================================
       5. 이동평균 계산
       최신 → 과거 데이터 기준
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
            Number(
              row.close || 0
            ),
          0
        );

      return (
        sum / period
      );
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
                : Math.round(
                    ma5 * 100
                  ) / 100,

            ma20:
              ma20 === null
                ? null
                : Math.round(
                    ma20 * 100
                  ) / 100,

            ma60:
              ma60 === null
                ? null
                : Math.round(
                    ma60 * 100
                  ) / 100
          };
        }
      );

    /* ==========================================
       6. 최신 추세
    ========================================== */

    const latest =
      chart[0];

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

    /*
      주의:
      예전 코드는 MA5 > MA20 > MA60만으로
      alignment를 판단했음.

      이제 score-engine과 동일하게

      현재가 > MA5 > MA20 > MA60

      일 때만 완전 정배열로 인정.
    */

    let ma20Rising = false;

    if (
      chart[0]?.ma20 != null &&
      chart[5]?.ma20 != null
    ) {
      ma20Rising =
        chart[0].ma20 >
        chart[5].ma20;
    }

    let ma60Rising = false;

    if (
      chart[0]?.ma60 != null &&
      chart[5]?.ma60 != null
    ) {
      ma60Rising =
        chart[0].ma60 >
        chart[5].ma60;
    }

    /* ==========================================
       7. 응답
    ========================================== */

    return res
      .status(200)
      .json({
        ok: true,

        code,

        name:
          latest.name,

        requestedDays:
          wantedDays,

        collectedDays:
          selected.length,

        latestDate:
          latest.date,

        cache: {
          browserSeconds: 300,
          cdnSeconds: 1800
        },

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
      "MARKET HISTORY ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        ok: false,

        error:
          String(error),

        stack:
          error?.stack ||
          null
      });
  }
};
