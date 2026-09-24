module.exports = async function handler(req, res) {
  try {
    /*
      ==================================================
      LEADER CYCLE - RANKINGS V4 FAST

      핵심:
      1. market-scan에서 후보 추출
      2. stock-detail 병렬 호출
      3. 동시 요청 수 제한
      4. 개별 실패해도 전체 rankings 유지
      5. 응답시간 보호를 위해 기본 후보 10개
      ==================================================
    */

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

    /*
      ==================================================
      HELPERS
      ==================================================
    */

    function num(value) {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }

    function clamp(value, min, max) {
      return Math.max(
        min,
        Math.min(max, value)
      );
    }

    async function fetchJson(
      url,
      timeoutMs = 25000
    ) {
      const controller =
        new AbortController();

      const timer =
        setTimeout(function () {
          controller.abort();
        }, timeoutMs);

      try {
        const response =
          await fetch(url, {
            signal: controller.signal
          });

        let json = null;

        try {
          json =
            await response.json();
        } catch (error) {
          throw new Error(
            `JSON_PARSE_ERROR HTTP ${response.status}`
          );
        }

        if (!response.ok) {
          throw new Error(
            json?.error ||
            `HTTP ${response.status}`
          );
        }

        return json;

      } finally {
        clearTimeout(timer);
      }
    }

    /*
      ==================================================
      OPTIONS

      기본 10개만 정밀분석.
      최대 15개까지만 허용.

      속도/안정성 우선.
      ==================================================
    */

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
        15
      );

    /*
      ==================================================
      1. MARKET SCAN
      ==================================================
    */

    const scanUrl =
      `${baseUrl}/api/market-scan?limit=${limit}`;

    let scan;

    try {
      scan =
        await fetchJson(
          scanUrl,
          30000
        );
    } catch (error) {
      return res.status(500).json({
        ok: false,
        version:
          "LEADER_CYCLE_RANKINGS_V4_FAST",
        error:
          "market-scan 호출 실패",
        detail:
          String(
            error?.message ||
            error
          )
      });
    }

    if (
      !scan ||
      scan.ok !== true ||
      !Array.isArray(scan.candidates)
    ) {
      return res.status(500).json({
        ok: false,
        version:
          "LEADER_CYCLE_RANKINGS_V4_FAST",
        error:
          "market-scan 데이터 형식 오류",
        detail: scan
      });
    }

    /*
      ==================================================
      후보 정리

      같은 종목 중복 제거
      ==================================================
    */

    const seenCodes =
      new Set();

    const candidates = [];

    for (
      const candidate of scan.candidates
    ) {
      const code =
        String(
          candidate?.code || ""
        ).trim();

      if (!/^\d{6}$/.test(code)) {
        continue;
      }

      if (seenCodes.has(code)) {
        continue;
      }

      seenCodes.add(code);

      candidates.push({
        ...candidate,
        code
      });

      if (
        candidates.length >= limit
      ) {
        break;
      }
    }

    if (!candidates.length) {
      return res.status(200).json({
        ok: true,

        version:
          "LEADER_CYCLE_RANKINGS_V4_FAST",

        date:
          scan.date || null,

        stats: {
          marketStocks:
            scan.market?.totalStocks || 0,

          discoveryCandidates: 0,

          analyzed: 0,

          failed: 0,

          buyable: 0
        },

        entryRanking: [],
        leaderRanking: [],
        earlyRanking: [],
        exhaustionRanking: [],
        failed: []
      });
    }

    /*
      ==================================================
      2. STOCK DETAIL

      한 종목 실패해도 rankings 전체는 계속.
      ==================================================
    */

    async function analyze(
      candidate
    ) {
      const code =
        candidate.code;

      try {
        const detailUrl =
          `${baseUrl}/api/stock-detail?code=${encodeURIComponent(code)}`;

        const detail =
          await fetchJson(
            detailUrl,
            35000
          );

        if (
          !detail ||
          detail.ok !== true
        ) {
          throw new Error(
            detail?.error ||
            "stock-detail 분석 실패"
          );
        }

        /*
          rankings에서는
          필요한 정보만 남긴다.
        */

        return {
          ok: true,

          code:
            detail.code ||
            code,

          name:
            detail.name ||
            candidate.name ||
            "",

          market:
            detail.market ||
            candidate.market ||
            null,

          date:
            detail.date ||
            scan.date ||
            null,

          price:
            num(detail.price),

          changeRate:
            num(
              candidate.changeRate ??
              detail.changeRate
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

          stage:
            detail.stage ||
            "DISCOVERY",

          entryStatus:
            detail.entryStatus ||
            "WAIT",

          blocked:
            detail.blocked === true,

          scores: {
            leader:
              num(
                detail.scores?.leader
              ),

            early:
              num(
                detail.scores?.early
              ),

            entry:
              num(
                detail.scores?.entry
              ),

            exhaustion:
              num(
                detail.scores
                  ?.exhaustion
              )
          },

          signals: {
            alignment:
              detail.signals
                ?.alignment === true,

            ma20Rising:
              detail.signals
                ?.ma20Rising === true,

            ma60Rising:
              detail.signals
                ?.ma60Rising === true,

            ma20To60Gap:
              num(
                detail.signals
                  ?.ma20To60Gap
              ),

            distance20:
              num(
                detail.signals
                  ?.distance20
              ),

            distance60:
              num(
                detail.signals
                  ?.distance60
              ),

            return5:
              num(
                detail.signals
                  ?.return5
              ),

            return10:
              num(
                detail.signals
                  ?.return10
              ),

            return20:
              num(
                detail.signals
                  ?.return20
              ),

            return60:
              num(
                detail.signals
                  ?.return60
              ),

            volumeRatio:
              num(
                detail.signals
                  ?.volumeRatio
              ),

            tradingValueRatio:
              num(
                detail.signals
                  ?.tradingValueRatio
              ),

            breakout20:
              detail.signals
                ?.breakout20 === true
          },

          reasons: {
            leader:
              Array.isArray(
                detail.scoreDetail
                  ?.leader
                  ?.reasons
              )
                ? detail.scoreDetail
                    .leader
                    .reasons
                    .slice(0, 4)
                : [],

            early:
              Array.isArray(
                detail.scoreDetail
                  ?.early
                  ?.reasons
              )
                ? detail.scoreDetail
                    .early
                    .reasons
                    .slice(0, 4)
                : [],

            entry:
              Array.isArray(
                detail.scoreDetail
                  ?.entry
                  ?.reasons
              )
                ? detail.scoreDetail
                    .entry
                    .reasons
                    .slice(0, 4)
                : [],

            exhaustion:
              Array.isArray(
                detail.scoreDetail
                  ?.exhaustion
                  ?.reasons
              )
                ? detail.scoreDetail
                    .exhaustion
                    .reasons
                    .slice(0, 4)
                : []
          },

          warnings: {
            leader:
              Array.isArray(
                detail.scoreDetail
                  ?.leader
                  ?.warnings
              )
                ? detail.scoreDetail
                    .leader
                    .warnings
                    .slice(0, 3)
                : [],

            early:
              Array.isArray(
                detail.scoreDetail
                  ?.early
                  ?.warnings
              )
                ? detail.scoreDetail
                    .early
                    .warnings
                    .slice(0, 3)
                : [],

            entry:
              Array.isArray(
                detail.scoreDetail
                  ?.entry
                  ?.warnings
              )
                ? detail.scoreDetail
                    .entry
                    .warnings
                    .slice(0, 3)
                : []
          }
        };

      } catch (error) {
        return {
          ok: false,

          code,

          name:
            candidate.name ||
            "",

          market:
            candidate.market ||
            null,

          error:
            error?.name ===
            "AbortError"
              ? "stock-detail timeout"
              : String(
                  error?.message ||
                  error
                )
        };
      }
    }

    /*
      ==================================================
      3. 병렬 분석

      중요:
      이전처럼 2개씩 돌리면 너무 느림.

      현재 market-history가 FAST 버전으로
      정상 작동하는 걸 확인했으므로
      5개씩 병렬 실행.

      후보 10개 =
      총 2 batch.
      ==================================================
    */

    const results = [];

    const batchSize = 5;

    for (
      let i = 0;
      i < candidates.length;
      i += batchSize
    ) {
      const batch =
        candidates.slice(
          i,
          i + batchSize
        );

      const batchResults =
        await Promise.all(
          batch.map(
            candidate =>
              analyze(candidate)
          )
        );

      results.push(
        ...batchResults
      );
    }

    /*
      ==================================================
      성공 / 실패
      ==================================================
    */

    const analyzed =
      results.filter(
        item =>
          item.ok === true
      );

    const failed =
      results.filter(
        item =>
          item.ok !== true
      );

    /*
      ==================================================
      ENTRY STATUS 재확인
      ==================================================
    */

    function getEntryStatus(
      stock
    ) {
      if (
        stock.blocked ||
        stock.scores.exhaustion >= 75
      ) {
        return "BLOCKED";
      }

      if (
        stock.scores.entry >= 80
      ) {
        return "ATTRACTIVE";
      }

      if (
        stock.scores.entry >= 65
      ) {
        return "WATCH";
      }

      if (
        stock.scores.entry >= 50
      ) {
        return "NEUTRAL";
      }

      return "AVOID";
    }

    for (
      const stock of analyzed
    ) {
      stock.entryStatus =
        getEntryStatus(stock);
    }

    /*
      ==================================================
      4. BUYABLE

      신규매수 후보에서 제외:
      - blocked
      - exhaustion >= 75
      - BROKEN
      - EXHAUSTING
      ==================================================
    */

    const buyable =
      analyzed.filter(
        function (stock) {
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

    /*
      ==================================================
      5. ENTRY RANKING
      ==================================================
    */

    const entryRanking =
      [...buyable]
        .sort(
          function (a, b) {
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
              b.discoveryScore -
              a.discoveryScore
            );
          }
        )
        .slice(0, 10);

    /*
      ==================================================
      6. LEADER RANKING
      ==================================================
    */

    const leaderRanking =
      [...analyzed]
        .filter(
          function (stock) {
            return (
              !stock.blocked &&
              stock.scores
                .exhaustion < 75
            );
          }
        )
        .sort(
          function (a, b) {
            if (
              b.scores.leader !==
              a.scores.leader
            ) {
              return (
                b.scores.leader -
                a.scores.leader
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
              b.discoveryScore -
              a.discoveryScore
            );
          }
        )
        .slice(0, 10);

    /*
      ==================================================
      7. EARLY RANKING
      ==================================================
    */

    const earlyRanking =
      [...buyable]
        .sort(
          function (a, b) {
            if (
              b.scores.early !==
              a.scores.early
            ) {
              return (
                b.scores.early -
                a.scores.early
              );
            }

            if (
              b.scores.entry !==
              a.scores.entry
            ) {
              return (
                b.scores.entry -
                a.scores.entry
              );
            }

            return (
              b.discoveryScore -
              a.discoveryScore
            );
          }
        )
        .slice(0, 10);

    /*
      ==================================================
      8. EXHAUSTION RANKING
      ==================================================
    */

    const exhaustionRanking =
      [...analyzed]
        .filter(
          function (stock) {
            return (
              stock.scores
                .exhaustion >= 25
            );
          }
        )
        .sort(
          function (a, b) {
            return (
              b.scores.exhaustion -
              a.scores.exhaustion
            );
          }
        )
        .slice(0, 10);

    /*
      ==================================================
      TOP PICKS
      ==================================================
    */

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

    /*
      ==================================================
      시장별 분석 성공 개수
      ==================================================
    */

    const analyzedMarket = {
      kospi: 0,
      kosdaq: 0,
      other: 0
    };

    for (
      const stock of analyzed
    ) {
      const market =
        String(
          stock.market || ""
        ).toUpperCase();

      if (market === "KOSPI") {
        analyzedMarket.kospi++;
      } else if (
        market === "KOSDAQ"
      ) {
        analyzedMarket.kosdaq++;
      } else {
        analyzedMarket.other++;
      }
    }

    /*
      ==================================================
      CACHE
      ==================================================
    */

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=1800, stale-while-revalidate=7200"
    );

    /*
      ==================================================
      RESPONSE
      ==================================================
    */

    return res.status(200).json({
      ok: true,

      version:
        "LEADER_CYCLE_RANKINGS_V4_FAST",

      requestedDate:
        scan.requestedDate ||
        null,

      date:
        scan.date ||
        null,

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

        analyzed:
          analyzed.length,

        failed:
          failed.length,

        buyable:
          buyable.length,

        analyzedMarket
      },

      scoreGuide: {
        discovery:
          "정밀분석 대상을 찾기 위한 1차 시장 탐색 점수",

        leader:
          "현재 실제 주도주로서의 추세·모멘텀·거래활동·지속성을 평가",

        early:
          "아직 과도하게 오르기 전 차기 주도주 전환 가능성을 평가",

        entry:
          "지금 신규 매수할 때의 추세·위치·모멘텀·거래활동을 평가",

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
          function (item) {
            return {
              code:
                item.code,

              name:
                item.name,

              market:
                item.market,

              error:
                item.error
            };
          }
        )
    });

  } catch (error) {
    console.error(
      "RANKINGS V4 ERROR",
      error
    );

    return res.status(500).json({
      ok: false,

      version:
        "LEADER_CYCLE_RANKINGS_V4_FAST",

      error:
        String(
          error?.message ||
          error
        )
    });
  }
};
