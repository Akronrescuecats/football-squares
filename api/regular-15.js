import crypto from "crypto";

const SHEET_NAME = "Squares";
const SETTINGS_SHEET_NAME = "Settings";
const BOARDS = { 1: { sheet: "Squares", settings: "Settings" }, 2: { sheet: "Squares 2", settings: "Settings 2" } };
function boardId(value) { const id = Number(value); if (id !== 1 && id !== 2) throw new Error("Invalid board."); return id; }
function boardItems(data) {
  if (Array.isArray(data?.selections)) {
    const seen = new Set();
    return data.selections.map(x => ({ board: boardId(x.board), square: Number(x.square) })).filter(x => {
      if (!Number.isInteger(x.square) || x.square < 1 || x.square > 100) throw new Error("Invalid square.");
      const key = `${x.board}:${x.square}`; if (seen.has(key)) throw new Error("Duplicate square."); seen.add(key); return true;
    });
  }
  return normalizeSquareList(data?.squares).map(square => ({board:1,square}));
}
function selectionLabel(items) { return items.map(x => `Board ${x.board} #${x.square}`).join(", "); }
const CURRENCY_CODE = "USD";

/*
=====================================================
GOOGLE AUTH
=====================================================
*/

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getGoogleCredentials() {
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is missing."
    );
  }

  let credentials;

  try {
    credentials =
      JSON.parse(raw);
  } catch (error) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON."
    );
  }

  if (
    !credentials.client_email ||
    !credentials.private_key
  ) {
    throw new Error(
      "Google credentials are incomplete."
    );
  }

  return credentials;
}

async function getAccessToken() {
  const credentials =
    getGoogleCredentials();

  const now =
    Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const claims = {
    iss:
      credentials.client_email,

    scope:
      "https://www.googleapis.com/auth/spreadsheets",

    aud:
      "https://oauth2.googleapis.com/token",

    iat:
      now,

    exp:
      now + 3600
  };

  const unsignedToken =
    base64Url(
      JSON.stringify(header)
    ) +
    "." +
    base64Url(
      JSON.stringify(claims)
    );

  const privateKey =
    crypto.createPrivateKey({
      key:
        credentials.private_key,

      format:
        "pem"
    });

  const signature =
    crypto.sign(
      "RSA-SHA256",
      Buffer.from(
        unsignedToken
      ),
      privateKey
    );

  const jwt =
    unsignedToken +
    "." +
    base64Url(signature);

  const response =
    await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          new URLSearchParams({
            grant_type:
              "urn:ietf:params:oauth:grant-type:jwt-bearer",

            assertion:
              jwt
          })
      }
    );

  const data =
    await response.json();

  if (
    !response.ok ||
    !data.access_token
  ) {
    throw new Error(
      data.error_description ||
      "Google authentication failed."
    );
  }

  return data.access_token;
}

/*
=====================================================
SPREADSHEET
=====================================================
*/

function getSpreadsheetId() {
  const id =
    process.env
      .REGULAR_15_SPREADSHEET_ID;

  if (!id) {
    throw new Error(
      "REGULAR_15_SPREADSHEET_ID is missing."
    );
  }

  return id;
}

/*
=====================================================
SETTINGS

B2 = Price Per Square
B3 = Board Title
B4 = Hold Minutes
B5 = 1st Quarter Payout
B6 = Halftime Payout
B7 = 3rd Quarter Payout
B8 = Final Payout
B9 = Final Touch
=====================================================
*/

async function getSettings(token, board = 1) {
  const spreadsheetId =
    getSpreadsheetId();

  const range =
    encodeURIComponent(
      `${BOARDS[boardId(board)].settings}!B2:B9`
    );

  const url =
    "https://sheets.googleapis.com/v4/spreadsheets/" +
    spreadsheetId +
    "/values/" +
    range;

  const response =
    await fetch(
      url,
      {
        headers: {
          Authorization:
            "Bearer " + token
        },

        cache:
          "no-store"
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "Could not read the Settings tab."
    );
  }

  const values =
    data.values || [];

  const getValue =
    function(index) {
      return values[index]?.[0] ?? "";
    };

  const pricePerSquare =
    Number(getValue(0));

  const boardTitle =
    String(
      getValue(1) ||
      "2026 Regular Season Week 15"
    ).trim();

  const holdMinutes =
    Number(getValue(2));

  const q1 =
    Number(getValue(3));

  const halftime =
    Number(getValue(4));

  const q3 =
    Number(getValue(5));

  const final =
    Number(getValue(6));

  const finalTouch =
    Number(getValue(7));

  if (
    !Number.isFinite(
      pricePerSquare
    ) ||
    pricePerSquare <= 0
  ) {
    throw new Error(
      "Price Per Square in Settings!B2 is invalid."
    );
  }

  if (
    !Number.isFinite(
      holdMinutes
    ) ||
    holdMinutes <= 0
  ) {
    throw new Error(
      "Hold Minutes in Settings!B4 is invalid."
    );
  }

  return {
    pricePerSquare,
    boardTitle,
    holdMinutes,

    payouts: {
      q1:
        Number.isFinite(q1)
          ? q1
          : 0,

      halftime:
        Number.isFinite(halftime)
          ? halftime
          : 0,

      q3:
        Number.isFinite(q3)
          ? q3
          : 0,

      final:
        Number.isFinite(final)
          ? final
          : 0,

      finalTouch:
        Number.isFinite(finalTouch)
          ? finalTouch
          : 0
    }
  };
}

/*
=====================================================
READ SQUARES
=====================================================
*/

async function getAllRows(token, board = 1) {
  const spreadsheetId =
    getSpreadsheetId();

  const range =
    encodeURIComponent(
      `${BOARDS[boardId(board)].sheet}!A2:L101`
    );

  const url =
    "https://sheets.googleapis.com/v4/spreadsheets/" +
    spreadsheetId +
    "/values/" +
    range;

  const response =
    await fetch(
      url,
      {
        headers: {
          Authorization:
            "Bearer " + token
        },

        cache:
          "no-store"
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "Could not read the football squares sheet."
    );
  }

  const sourceRows =
    data.values || [];

  const rows = [];

  for (
    let index = 0;
    index < 100;
    index++
  ) {
    const source =
      sourceRows[index] || [];

    rows.push([
      source[0] ||
        String(index + 1),

      source[1] ||
        "Available",

      source[2] || "",
      source[3] || "",
      source[4] || "",
      source[5] || "",
      source[6] || "",
      source[7] || "",
      source[8] || "",
      source[9] || "",
      source[10] || "",
      source[11] || ""
    ]);
  }

  return rows;
}

/*
=====================================================
UPDATE SQUARES
=====================================================
*/

async function batchUpdateRows(
  token,
  updates
) {
  if (
    !Array.isArray(updates) ||
    updates.length === 0
  ) {
    return;
  }

  const spreadsheetId =
    getSpreadsheetId();

  const url =
    "https://sheets.googleapis.com/v4/spreadsheets/" +
    spreadsheetId +
    "/values:batchUpdate";

  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          Authorization:
            "Bearer " + token,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            valueInputOption:
              "RAW",

            data:
              updates
          })
      }
    );

  const result =
    await response.json();

  if (!response.ok) {
    throw new Error(
      result?.error?.message ||
      "Could not update the football squares sheet."
    );
  }

  return result;
}

/*
=====================================================
HELPERS
=====================================================
*/

function normalizeStatus(value) {
  const status =
    String(value || "")
      .trim()
      .toLowerCase();

  if (status === "sold") {
    return "Sold";
  }

  if (status === "pending") {
    return "Pending";
  }

  return "Available";
}

function normalizeSquareList(values) {
  if (!Array.isArray(values)) {
    throw new Error(
      "Please select at least one square."
    );
  }

  const squares =
    Array.from(
      new Set(
        values.map(
          function(value) {
            return Number(value);
          }
        )
      )
    )
      .filter(
        function(number) {
          return (
            Number.isInteger(number) &&
            number >= 1 &&
            number <= 100
          );
        }
      )
      .sort(
        function(a, b) {
          return a - b;
        }
      );

  if (!squares.length) {
    throw new Error(
      "Please select at least one square."
    );
  }

  return squares;
}

function rowsToPublicSquares(rows) {
  return rows.map(
    function(row, index) {
      return {
        square:
          Number(
            row[0] ||
            index + 1
          ),

        status:
          normalizeStatus(
            row[1]
          ),

        name:
          String(
            row[2] || ""
          )
      };
    }
  );
}

/*
=====================================================
RELEASE EXPIRED RESERVATIONS
=====================================================
*/

async function releaseExpiredReservations(
  token,
  rows,
  holdMinutes,
  board = 1
) {
  const sheetName = BOARDS[boardId(board)].sheet;
  const now =
    Date.now();

  const updates = [];

  rows.forEach(
    function(row, index) {

      if (
        normalizeStatus(
          row[1]
        ) !== "Pending"
      ) {
        return;
      }

      const reservedAt =
        new Date(
          row[5]
        );

      if (
        Number.isNaN(
          reservedAt.getTime()
        )
      ) {
        return;
      }

      const minutesPassed =
        (
          now -
          reservedAt.getTime()
        ) / 60000;

      if (
        minutesPassed <
        holdMinutes
      ) {
        return;
      }

      const sheetRow =
        index + 2;

      updates.push({
        range:
          `${sheetName}!B${sheetRow}:L${sheetRow}`,

        values: [[
          "Available",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          ""
        ]]
      });
    }
  );

  await batchUpdateRows(
    token,
    updates
  );

  return updates.length;
}

/*
=====================================================
RESERVE SQUARES
=====================================================
*/

async function reserveSquares(token, formData) {
  if (!formData) throw new Error("Reservation information is missing.");
  const selections = boardItems(formData);
  if (!selections.length) throw new Error("Please select squares.");
  const name = String(formData.name || "").trim();
  const email = String(formData.email || "").trim().toLowerCase();
  const phone = String(formData.phone || "").trim();
  if (!name || !email || !phone) throw new Error("Please enter your name, email, and phone number.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Please enter a valid email address.");
  const settings = await getSettings(token, 1);
  const secondSettings = await getSettings(token, 2);
  if (settings.pricePerSquare !== secondSettings.pricePerSquare) throw new Error("Board prices differ; combined checkout is unavailable.");
  const rows = {};
  for (const board of [1,2]) {
    rows[board] = await getAllRows(token, board);
    await releaseExpiredReservations(token, rows[board], board === 1 ? settings.holdMinutes : secondSettings.holdMinutes, board);
    rows[board] = await getAllRows(token, board);
  }
  const unavailable = selections.filter(x => normalizeStatus(rows[x.board][x.square-1][1]) !== "Available");
  if (unavailable.length) throw new Error("No longer available: " + selectionLabel(unavailable));
  const reservedAt = new Date().toISOString();
  const reservationId = crypto.randomUUID();
  const updates = selections.map(x => ({
    range: `${BOARDS[x.board].sheet}!B${x.square+1}:L${x.square+1}`,
    values: [["Pending",name,email,phone,reservedAt,"","Awaiting Payment","","","",reservationId]]
  }));
  await batchUpdateRows(token, updates);
  return {success:true, selections, squares:selections.map(x=>x.square), name,email,phone,
    quantity:selections.length, pricePerSquare:settings.pricePerSquare,
    total:selections.length*settings.pricePerSquare,
    expiresInMinutes:Math.min(settings.holdMinutes,secondSettings.holdMinutes),reservationId,settings};
}

/*
=====================================================
PAYPAL AUTH
=====================================================
*/

async function getPayPalAccessToken() {
  const clientId =
    process.env
      .PAYPAL_CLIENT_ID;

  const clientSecret =
    process.env
      .PAYPAL_CLIENT_SECRET;

  if (
    !clientId ||
    !clientSecret
  ) {
    throw new Error(
      "PayPal credentials are missing."
    );
  }

  const authorization =
    Buffer
      .from(
        clientId +
        ":" +
        clientSecret
      )
      .toString(
        "base64"
      );

  const response =
    await fetch(
      "https://api-m.paypal.com/v1/oauth2/token",
      {
        method: "POST",

        headers: {
          Authorization:
            "Basic " +
            authorization,

          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          "grant_type=client_credentials"
      }
    );

  const data =
    await response.json();

  if (
    !response.ok ||
    !data.access_token
  ) {
    throw new Error(
      data?.error_description ||
      "PayPal authentication failed."
    );
  }

  return data.access_token;
}

async function getPayPalOrder(
  orderId
) {
  const accessToken =
    await getPayPalAccessToken();

  const response =
    await fetch(
      "https://api-m.paypal.com/v2/checkout/orders/" +
      encodeURIComponent(
        orderId
      ),
      {
        method: "GET",

        headers: {
          Authorization:
            "Bearer " +
            accessToken,

          Accept:
            "application/json"
        },

        cache:
          "no-store"
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.message ||
      "PayPal could not verify this order."
    );
  }

  return data;
}

function makePayPalRequestId(
  type,
  reservationId
) {
  return crypto
    .createHash(
      "sha256"
    )
    .update(
      type +
      ":" +
      reservationId
    )
    .digest(
      "hex"
    )
    .slice(
      0,
      36
    );
}

/*
=====================================================
VALIDATE PAYPAL RESERVATION
=====================================================
*/

async function validatePayPalReservation(googleToken, paymentData) {
  const email = String(paymentData?.email || "").trim().toLowerCase();
  const reservationId = String(paymentData?.reservationId || "").trim();
  const selections = boardItems(paymentData);
  if (!email || !reservationId || !selections.length) throw new Error("PayPal reservation information is incomplete.");
  const settings = await getSettings(googleToken, 1);
  const settings2 = await getSettings(googleToken, 2);
  if (settings.pricePerSquare !== settings2.pricePerSquare) throw new Error("Board prices do not match.");
  const rows = {};
  for (const board of [1,2]) {
    rows[board] = await getAllRows(googleToken,board);
    await releaseExpiredReservations(googleToken,rows[board],board===1?settings.holdMinutes:settings2.holdMinutes,board);
    rows[board] = await getAllRows(googleToken,board);
  }
  for (const x of selections) {
    const row = rows[x.board][x.square-1];
    if (normalizeStatus(row[1]) !== "Pending" || String(row[3]||"").trim().toLowerCase() !== email || String(row[11]||"").trim() !== reservationId)
      throw new Error(`Board ${x.board} square ${x.square} is no longer reserved for this checkout.`);
  }
  // Ensure the checkout includes every square belonging to this reservation.
  const all = [];
  for (const board of [1,2]) rows[board].forEach((row,i)=>{
    if (normalizeStatus(row[1]) === "Pending" && String(row[11]||"").trim() === reservationId) all.push(`${board}:${i+1}`);
  });
  const chosen = selections.map(x=>`${x.board}:${x.square}`);
  if (all.length !== chosen.length || all.some(x=>!chosen.includes(x))) throw new Error("Reservation square list does not match.");
  return {rows,selections,squares:selections.map(x=>x.square),email,reservationId,settings,total:selections.length*settings.pricePerSquare};
}

/*
=====================================================
CREATE PAYPAL ORDER
=====================================================
*/

async function createPayPalOrder(
  googleToken,
  paymentData
) {
  const reservation =
    await validatePayPalReservation(
      googleToken,
      paymentData
    );

  const accessToken =
    await getPayPalAccessToken();

  const requestId =
    makePayPalRequestId(
      "create",
      reservation.reservationId
    );

  const response =
    await fetch(
      "https://api-m.paypal.com/v2/checkout/orders",
      {
        method: "POST",

        headers: {
          Authorization:
            "Bearer " +
            accessToken,

          "Content-Type":
            "application/json",

          "PayPal-Request-Id":
            requestId,

          Prefer:
            "return=representation"
        },

        body:
          JSON.stringify({
            intent:
              "CAPTURE",

            purchase_units: [
              {
                custom_id:
                  reservation.reservationId,

                description:
                  "Akron Rescue Cats Regular Season Board 15 Football Squares: " +
                  selectionLabel(reservation.selections),

                amount: {
                  currency_code:
                    CURRENCY_CODE,

                  value:
                    reservation.total
                      .toFixed(2)
                }
              }
            ]
          })
      }
    );

  const data =
    await response.json();

  if (
    !response.ok ||
    !data.id
  ) {
    throw new Error(
      data?.message ||
      data?.details?.[0]?.description ||
      "PayPal could not create the order."
    );
  }

  return {
    success: true,
    orderId:
      data.id
  };
}

/*
=====================================================
VERIFY PAYPAL
=====================================================
*/

function verifyCompletedPayPalOrder(
  paypalOrder,
  expectedTotal,
  reservationId
) {
  if (
    String(
      paypalOrder?.status || ""
    ).toUpperCase() !==
    "COMPLETED"
  ) {
    throw new Error(
      "The PayPal payment is not completed."
    );
  }

  const purchaseUnits =
    Array.isArray(
      paypalOrder.purchase_units
    )
      ? paypalOrder.purchase_units
      : [];

  let paidTotal = 0;

  let reservationMatches =
    false;

  purchaseUnits.forEach(
    function(unit) {

      if (
        String(
          unit.custom_id || ""
        ) ===
        reservationId
      ) {
        reservationMatches =
          true;
      }

      const captures =
        unit?.payments?.captures;

      if (!Array.isArray(captures)) {
        return;
      }

      captures.forEach(
        function(capture) {

          if (
            String(
              capture.status || ""
            ).toUpperCase() !==
            "COMPLETED"
          ) {
            return;
          }

          const currency =
            String(
              capture
                ?.amount
                ?.currency_code ||
              ""
            ).toUpperCase();

          if (
            currency !==
            CURRENCY_CODE
          ) {
            throw new Error(
              "The PayPal payment currency is incorrect."
            );
          }

          paidTotal +=
            Number(
              capture
                ?.amount
                ?.value ||
              0
            );
        }
      );
    }
  );

  if (!reservationMatches) {
    throw new Error(
      "The PayPal payment does not match this reservation."
    );
  }

  if (
    Math.round(
      paidTotal * 100
    ) !==
    Math.round(
      expectedTotal * 100
    )
  ) {
    throw new Error(
      "The PayPal payment amount does not match the reservation."
    );
  }
}

/*
=====================================================
CAPTURE PAYPAL
=====================================================
*/

async function capturePayPalOrder(
  googleToken,
  paymentData
) {
  const orderId =
    String(
      paymentData?.orderId || ""
    ).trim();

  if (!orderId) {
    throw new Error(
      "The PayPal order ID is missing."
    );
  }

  const currentRows = [...await getAllRows(googleToken,1), ...await getAllRows(googleToken,2)];

  const alreadyPaid =
    currentRows.some(
      function(row) {
        return (
          String(
            row[8] || ""
          ) === orderId &&

          String(
            row[7] || ""
          )
            .trim()
            .toLowerCase() ===
            "paid"
        );
      }
    );

  if (alreadyPaid) {
    return {
      success: true,
      alreadyProcessed: true,
      orderId
    };
  }

  const reservation =
    await validatePayPalReservation(
      googleToken,
      paymentData
    );

  const accessToken =
    await getPayPalAccessToken();

  const requestId =
    makePayPalRequestId(
      "capture",
      reservation.reservationId
    );

  const response =
    await fetch(
      "https://api-m.paypal.com/v2/checkout/orders/" +
      encodeURIComponent(
        orderId
      ) +
      "/capture",
      {
        method: "POST",

        headers: {
          Authorization:
            "Bearer " +
            accessToken,

          "Content-Type":
            "application/json",

          "PayPal-Request-Id":
            requestId,

          Prefer:
            "return=representation"
        },

        body:
          "{}"
      }
    );

  const captureResult =
    await response.json();

  let paypalOrder;

  try {
    paypalOrder =
      await getPayPalOrder(
        orderId
      );
  } catch (error) {
    paypalOrder =
      captureResult;
  }

  if (
    !response.ok &&
    String(
      paypalOrder?.status || ""
    ).toUpperCase() !==
      "COMPLETED"
  ) {
    throw new Error(
      captureResult?.message ||
      captureResult
        ?.details?.[0]
        ?.description ||
      "PayPal could not capture the payment."
    );
  }

  verifyCompletedPayPalOrder(
    paypalOrder,
    reservation.total,
    reservation.reservationId
  );

  const paymentDate =
    new Date()
      .toISOString();

  const updates = [];

  reservation.selections.forEach(function(item) {
    const row = reservation.rows[item.board][item.square - 1];
    const sheetRow = item.square + 1;
    updates.push({
      range: `${BOARDS[item.board].sheet}!B${sheetRow}:L${sheetRow}`,
      values: [["Sold",row[2]||"",row[3]||"",row[4]||"",row[5]||"","PayPal","Paid",orderId,
        reservation.settings.pricePerSquare,paymentDate,reservation.reservationId]]
    });
  });

  await batchUpdateRows(
    googleToken,
    updates
  );

  return {
    success: true,
    orderId,
    selections: reservation.selections,
    squares: reservation.squares,
    amount:
      reservation.total
  };
}

/*
=====================================================
ZEFFY / VENMO
=====================================================
*/

async function savePaymentMethod(googleToken, paymentData) {
  const method = String(paymentData?.paymentMethod||"").trim().toLowerCase();
  if (!["zeffy","venmo"].includes(method)) throw new Error("Invalid payment method.");
  const reservation = await validatePayPalReservation(googleToken,paymentData);
  const updates = reservation.selections.map(x=>({
    range:`${BOARDS[x.board].sheet}!G${x.square+1}:H${x.square+1}`,
    values:[[method==="zeffy"?"Zeffy":"Venmo","Payment Pending"]]
  }));
  await batchUpdateRows(googleToken,updates);
  return {success:true,paymentMethod:method,selections:reservation.selections};
}

/*
=====================================================
ZEFFY WEBHOOK HELPERS
=====================================================
*/

function getZeffyEventType(body) {
  return String(
    body?.type ||
    body?.event ||
    body?.event_type ||
    body?.eventType ||
    ""
  )
    .trim()
    .toLowerCase();
}

function getZeffyPaymentObject(body) {
  return (
    body?.data?.payment ||
    body?.payment ||
    body?.data ||
    body ||
    {}
  );
}

function firstNonBlank(values) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      return value;
    }
  }

  return "";
}

function getZeffyBuyerEmail(payment) {
  return String(
    firstNonBlank([
      payment?.buyer?.email,
      payment?.contact?.email,
      payment?.customer?.email,
      payment?.billing_details?.email,
      payment?.billingDetails?.email,
      payment?.payer?.email,
      payment?.email,
      payment?.buyer_email,
      payment?.buyerEmail,
      payment?.contact_email,
      payment?.contactEmail
    ])
  )
    .trim()
    .toLowerCase();
}

function getZeffyPaymentId(payment) {
  return String(
    firstNonBlank([
      payment?.id,
      payment?.payment_id,
      payment?.paymentId,
      payment?.transaction_id,
      payment?.transactionId,
      payment?.uuid
    ])
  ).trim();
}

function getZeffyPaymentStatus(payment) {
  return String(
    firstNonBlank([
      payment?.status,
      payment?.payment_status,
      payment?.paymentStatus
    ])
  )
    .trim()
    .toLowerCase();
}

/*
=====================================================
PROCESS COMPLETED ZEFFY PAYMENT
=====================================================
*/

async function processZeffyCompletedPayment(
  googleToken,
  body
) {
  const payment =
    getZeffyPaymentObject(body);

  const email =
    getZeffyBuyerEmail(payment);

  const paymentId =
    getZeffyPaymentId(payment);

  const paymentStatus =
    getZeffyPaymentStatus(payment);

  if (!email) {
    throw new Error(
      "Zeffy completed payment did not include a buyer email."
    );
  }

  if (
    paymentStatus &&
    ![
      "succeeded",
      "completed",
      "paid",
      "success"
    ].includes(paymentStatus)
  ) {
    throw new Error(
      "Zeffy payment is not marked completed."
    );
  }

  const boardRows = {1: await getAllRows(googleToken,1), 2: await getAllRows(googleToken,2)};
  const rows = [...boardRows[1],...boardRows[2]];

  if (paymentId) {
    const alreadyProcessed =
      rows.some(
        function(row) {
          return (
            String(
              row[8] || ""
            ).trim() ===
              paymentId &&

            String(
              row[7] || ""
            )
              .trim()
              .toLowerCase() ===
              "paid"
          );
        }
      );

    if (alreadyProcessed) {
      return {
        success: true,
        alreadyProcessed: true,
        paymentId
      };
    }
  }

  const matchingRows = [];

  for (const board of [1,2]) boardRows[board].forEach(function(row,index) {
    const status = normalizeStatus(row[1]);
    const rowEmail = String(row[3]||"").trim().toLowerCase();
    const method = String(row[6]||"").trim().toLowerCase();
    if (status === "Pending" && rowEmail === email && method === "zeffy") {
      matchingRows.push({board,index,row,reservationId:String(row[11]||"").trim()});
    }
  });

  if (!matchingRows.length) {
    throw new Error(
      "No pending Zeffy reservation matched buyer email " +
      email +
      "."
    );
  }

  const groups =
    new Map();

  matchingRows.forEach(
    function(item) {

      const key =
        item.reservationId ||
        `row-${item.index}`;

      if (!groups.has(key)) {
        groups.set(
          key,
          []
        );
      }

      groups
        .get(key)
        .push(item);
    }
  );

  if (groups.size !== 1) {
    throw new Error(
      "More than one pending Zeffy reservation exists for " +
      email +
      ". Manual review is required."
    );
  }

  const reservationRows =
    Array.from(
      groups.values()
    )[0];

  const paymentDate =
    new Date()
      .toISOString();

  const updates = [];

  reservationRows.forEach(
    function(item) {

      const row =
        item.row;

      const sheetRow =
        item.index + 2;

      updates.push({
        range:
          `${BOARDS[item.board].sheet}!B${sheetRow}:L${sheetRow}`,

        values: [[
          "Sold",
          row[2] || "",
          row[3] || "",
          row[4] || "",
          row[5] || "",
          "Zeffy",
          "Paid",
          paymentId || "Zeffy",
          row[9] || "",
          paymentDate,
          row[11] || ""
        ]]
      });
    }
  );

  await batchUpdateRows(
    googleToken,
    updates
  );

  return {
    success: true,

    paymentId:
      paymentId || "",

    email,

    squares:
      reservationRows.map(
        function(item) {
          return Number(
            item.row[0]
          );
        }
      )
  };
}

/*
=====================================================
MAIN API
=====================================================
*/

export default {

  async fetch(request) {

    try {

      const token =
        await getAccessToken();

      /*
      ===============================================
      HANDLE POST REQUESTS
      ===============================================
      */

      if (
        request.method ===
        "POST"
      ) {

        const rawBody =
          await request.text();

        let body;

        try {
          body =
            rawBody
              ? JSON.parse(rawBody)
              : {};
        } catch (error) {
          throw new Error(
            "Request body is not valid JSON."
          );
        }

        /*
        -----------------------------------------------
        ZEFFY PAYMENT COMPLETED WEBHOOK
        -----------------------------------------------
        */

        const eventType =
          getZeffyEventType(
            body
          );

        if (
          eventType ===
          "payment.completed"
        ) {

          const result =
            await processZeffyCompletedPayment(
              token,
              body
            );

          return Response.json(
            result,
            {
              status: 200
            }
          );
        }

        /*
        -----------------------------------------------
        NORMAL WEBSITE ACTIONS
        -----------------------------------------------
        */

        if (
          body.action ===
          "reserveSquares"
        ) {
          return Response.json(
            await reserveSquares(
              token,
              body.data
            )
          );
        }

        if (
          body.action ===
          "createPayPalOrder"
        ) {
          return Response.json(
            await createPayPalOrder(
              token,
              body.data
            )
          );
        }

        if (
          body.action ===
          "capturePayPalOrder"
        ) {
          return Response.json(
            await capturePayPalOrder(
              token,
              body.data
            )
          );
        }

        if (
          body.action ===
          "savePaymentMethod"
        ) {
          return Response.json(
            await savePaymentMethod(
              token,
              body.data
            )
          );
        }

        return Response.json(
          {
            success: false,

            message:
              "Invalid API action."
          },
          {
            status: 400
          }
        );
      }

      /*
      ===============================================
      HANDLE GET REQUESTS
      ===============================================
      */

      const settings =
        await getSettings(
          token
        );

      if (
        request.method ===
        "GET"
      ) {

        const boards = {};
        for (const board of [1,2]) {
          const boardSettings = await getSettings(token,board);
          let rows = await getAllRows(token,board);
          await releaseExpiredReservations(token,rows,boardSettings.holdMinutes,board);
          rows = await getAllRows(token,board);
          boards[board] = {settings:boardSettings,squares:rowsToPublicSquares(rows)};
        }
        return Response.json({success:true,settings:boards[1].settings,squares:boards[1].squares,boards});
      }

      return Response.json(
        {
          success: false,

          message:
            "Method not allowed."
        },
        {
          status: 405
        }
      );

    } catch (error) {

      console.error(
        "Regular Season Board 15 API error:",
        error
      );

      return Response.json(
        {
          success: false,

          message:
            error?.message ||
            String(error)
        },
        {
          status: 500
        }
      );
    }
  }
};
