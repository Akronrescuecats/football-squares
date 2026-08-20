const crypto = require("crypto");

const SHEET_NAME = "Squares";
const SETTINGS_SHEET_NAME = "Settings";
const CURRENCY_CODE = "USD";

/*
=====================================================
GOOGLE AUTH
=====================================================
*/

function base64Url(input) {
  return Buffer
    .from(input)
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
    process.env.SEASON_LONG_SPREADSHEET_ID;

  if (!id) {
    throw new Error(
      "SEASON_LONG_SPREADSHEET_ID is missing."
    );
  }

  return id;
}

/*
=====================================================
SETTINGS
=====================================================
*/

async function getSettings(token) {
  const spreadsheetId =
    getSpreadsheetId();

  const range =
    encodeURIComponent(
      `${SETTINGS_SHEET_NAME}!B2:B8`
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
      "2026 Season-Long Football Squares"
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

  if (
    !Number.isFinite(pricePerSquare) ||
    pricePerSquare <= 0
  ) {
    throw new Error(
      "Price Per Square in Settings!B2 is invalid."
    );
  }

  if (
    !Number.isFinite(holdMinutes) ||
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
          : 0
    }
  };
}

/*
=====================================================
READ SQUARES
=====================================================
*/

async function getAllRows(token) {
  const spreadsheetId =
    getSpreadsheetId();

  const range =
    encodeURIComponent(
      `${SHEET_NAME}!A2:L101`
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
UPDATE SHEET
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

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "Could not update the football squares sheet."
    );
  }

  return data;
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
RELEASE EXPIRED HOLDS
=====================================================
*/

async function releaseExpiredReservations(
  token,
  rows,
  holdMinutes
) {
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
        new Date(row[5]);

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
          `${SHEET_NAME}!B${sheetRow}:L${sheetRow}`,

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
}

/*
=====================================================
RESERVE SQUARES
=====================================================
*/

async function reserveSquares(
  token,
  formData
) {
  const settings =
    await getSettings(token);

  if (!formData) {
    throw new Error(
      "Reservation information is missing."
    );
  }

  const squares =
    normalizeSquareList(
      formData.squares
    );

  const name =
    String(
      formData.name || ""
    ).trim();

  const email =
    String(
      formData.email || ""
    )
      .trim()
      .toLowerCase();

  const phone =
    String(
      formData.phone || ""
    ).trim();

  if (
    !name ||
    !email ||
    !phone
  ) {
    throw new Error(
      "Please enter your name, email, and phone number."
    );
  }

  let rows =
    await getAllRows(token);

  await releaseExpiredReservations(
    token,
    rows,
    settings.holdMinutes
  );

  rows =
    await getAllRows(token);

  const unavailable =
    [];

  squares.forEach(
    function(squareNumber) {

      if (
        normalizeStatus(
          rows[
            squareNumber - 1
          ][1]
        ) !==
        "Available"
      ) {
        unavailable.push(
          squareNumber
        );
      }
    }
  );

  if (unavailable.length) {
    throw new Error(
      "These squares are no longer available: " +
      unavailable.join(", ")
    );
  }

  const reservedAt =
    new Date()
      .toISOString();

  const reservationId =
    crypto.randomUUID();

  const updates = [];

  squares.forEach(
    function(squareNumber) {

      const sheetRow =
        squareNumber + 1;

      updates.push({
        range:
          `${SHEET_NAME}!B${sheetRow}:L${sheetRow}`,

        values: [[
          "Pending",
          name,
          email,
          phone,
          reservedAt,
          "",
          "Awaiting Payment",
          "",
          "",
          "",
          reservationId
        ]]
      });
    }
  );

  await batchUpdateRows(
    token,
    updates
  );

  return {
    success: true,
    squares,
    name,
    email,
    phone,

    quantity:
      squares.length,

    pricePerSquare:
      settings.pricePerSquare,

    total:
      squares.length *
      settings.pricePerSquare,

    expiresInMinutes:
      settings.holdMinutes,

    reservationId,
    settings
  };
}

/*
=====================================================
PAYPAL AUTH
=====================================================
*/

async function getPayPalAccessToken() {
  const clientId =
    process.env.PAYPAL_CLIENT_ID;

  const clientSecret =
    process.env.PAYPAL_CLIENT_SECRET;

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
        method:
          "POST",

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

async function getPayPalOrder(orderId) {
  const accessToken =
    await getPayPalAccessToken();

  const response =
    await fetch(
      "https://api-m.paypal.com/v2/checkout/orders/" +
      encodeURIComponent(
        orderId
      ),
      {
        headers: {
          Authorization:
            "Bearer " +
            accessToken
        },

        cache:
          "no-store"
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
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
    .createHash("sha256")
    .update(
      type +
      ":" +
      reservationId
    )
    .digest("hex")
    .slice(0, 36);
}

/*
=====================================================
VALIDATE PAYPAL RESERVATION
=====================================================
*/

async function validatePayPalReservation(
  token,
  paymentData
) {
  const settings =
    await getSettings(token);

  const email =
    String(
      paymentData?.email || ""
    )
      .trim()
      .toLowerCase();

  const reservationId =
    String(
      paymentData?.reservationId || ""
    ).trim();

  const squares =
    normalizeSquareList(
      paymentData?.squares
    );

  let rows =
    await getAllRows(token);

  await releaseExpiredReservations(
    token,
    rows,
    settings.holdMinutes
  );

  rows =
    await getAllRows(token);

  squares.forEach(
    function(squareNumber) {

      const row =
        rows[
          squareNumber - 1
        ];

      if (
        normalizeStatus(
          row[1]
        ) !== "Pending"
      ) {
        throw new Error(
          "Square " +
          squareNumber +
          " is no longer pending."
        );
      }

      if (
        String(
          row[3] || ""
        )
          .trim()
          .toLowerCase() !==
        email
      ) {
        throw new Error(
          "The reservation email does not match."
        );
      }

      if (
        String(
          row[11] || ""
        ).trim() !==
        reservationId
      ) {
        throw new Error(
          "The reservation ID does not match."
        );
      }
    }
  );

  return {
    rows,
    squares,
    email,
    reservationId,
    settings,

    total:
      squares.length *
      settings.pricePerSquare
  };
}

/*
=====================================================
CREATE PAYPAL ORDER
=====================================================
*/

async function createPayPalOrder(
  token,
  paymentData
) {
  const reservation =
    await validatePayPalReservation(
      token,
      paymentData
    );

  const accessToken =
    await getPayPalAccessToken();

  const response =
    await fetch(
      "https://api-m.paypal.com/v2/checkout/orders",
      {
        method:
          "POST",

        headers: {
          Authorization:
            "Bearer " +
            accessToken,

          "Content-Type":
            "application/json",

          "PayPal-Request-Id":
            makePayPalRequestId(
              "create",
              reservation.reservationId
            )
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
                  "Akron Rescue Cats Season-Long Football Squares: " +
                  reservation.squares.join(", "),

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
      "PayPal could not create the order."
    );
  }

  return {
    success: true,
    orderId: data.id
  };
}

/*
=====================================================
VERIFY PAYPAL
=====================================================
*/

function verifyCompletedPayPalOrder(
  order,
  expectedTotal,
  reservationId
) {
  if (
    String(
      order?.status || ""
    ).toUpperCase() !==
    "COMPLETED"
  ) {
    throw new Error(
      "The PayPal payment is not completed."
    );
  }

  let paidTotal = 0;
  let reservationMatches = false;

  const units =
    Array.isArray(
      order.purchase_units
    )
      ? order.purchase_units
      : [];

  units.forEach(
    function(unit) {

      if (
        String(
          unit.custom_id || ""
        ) ===
        reservationId
      ) {
        reservationMatches = true;
      }

      const captures =
        unit?.payments?.captures;

      if (
        !Array.isArray(captures)
      ) {
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

          /*
          PayPal may return the custom_id
          on the capture instead of the
          purchase unit.
          */

          if (
            String(
              capture.custom_id || ""
            ) ===
            reservationId
          ) {
            reservationMatches = true;
          }

          if (
            String(
              capture?.amount?.currency_code ||
              ""
            ).toUpperCase() !==
            CURRENCY_CODE
          ) {
            throw new Error(
              "The PayPal payment currency is incorrect."
            );
          }

          paidTotal +=
            Number(
              capture?.amount?.value ||
              0
            );
        }
      );
    }
  );

  if (
    !reservationMatches
  ) {
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
  token,
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

  const reservation =
    await validatePayPalReservation(
      token,
      paymentData
    );

  const accessToken =
    await getPayPalAccessToken();

  const response =
    await fetch(
      "https://api-m.paypal.com/v2/checkout/orders/" +
      encodeURIComponent(
        orderId
      ) +
      "/capture",
      {
        method:
          "POST",

        headers: {
          Authorization:
            "Bearer " +
            accessToken,

          "Content-Type":
            "application/json",

          "PayPal-Request-Id":
            makePayPalRequestId(
              "capture",
              reservation.reservationId
            )
        },

        body:
          "{}"
      }
    );

  let order =
    await response.json();

  if (!response.ok) {
    order =
      await getPayPalOrder(
        orderId
      );
  }

  verifyCompletedPayPalOrder(
    order,
    reservation.total,
    reservation.reservationId
  );

  const paymentDate =
    new Date()
      .toISOString();

  const updates = [];

  reservation.squares.forEach(
    function(squareNumber) {

      const row =
        reservation.rows[
          squareNumber - 1
        ];

      const sheetRow =
        squareNumber + 1;

      updates.push({
        range:
          `${SHEET_NAME}!B${sheetRow}:L${sheetRow}`,

        values: [[
          "Sold",
          row[2] || "",
          row[3] || "",
          row[4] || "",
          row[5] || "",
          "PayPal",
          "Paid",
          orderId,
          reservation.settings
            .pricePerSquare,
          paymentDate,
          reservation.reservationId
        ]]
      });
    }
  );

  await batchUpdateRows(
    token,
    updates
  );

  return {
    success: true,
    orderId,
    squares:
      reservation.squares,
    amount:
      reservation.total
  };
}

/*
=====================================================
ZEFFY / VENMO SELECTION
=====================================================
*/

async function savePaymentMethod(
  token,
  paymentData
) {
  const email =
    String(
      paymentData?.email || ""
    )
      .trim()
      .toLowerCase();

  const method =
    String(
      paymentData?.paymentMethod || ""
    )
      .trim()
      .toLowerCase();

  const squares =
    normalizeSquareList(
      paymentData?.squares
    );

  if (
    method !== "zeffy" &&
    method !== "venmo"
  ) {
    throw new Error(
      "That payment method is not valid."
    );
  }

  const rows =
    await getAllRows(token);

  const updates = [];

  squares.forEach(
    function(squareNumber) {

      const row =
        rows[
          squareNumber - 1
        ];

      if (
        normalizeStatus(
          row[1]
        ) !== "Pending"
      ) {
        throw new Error(
          "Square " +
          squareNumber +
          " is no longer pending."
        );
      }

      if (
        String(
          row[3] || ""
        )
          .trim()
          .toLowerCase() !==
        email
      ) {
        throw new Error(
          "The reservation email does not match."
        );
      }

      const sheetRow =
        squareNumber + 1;

      updates.push({
        range:
          `${SHEET_NAME}!G${sheetRow}:H${sheetRow}`,

        values: [[
          method === "zeffy"
            ? "Zeffy"
            : "Venmo",

          "Payment Pending"
        ]]
      });
    }
  );

  await batchUpdateRows(
    token,
    updates
  );

  return {
    success: true,
    paymentMethod: method,
    squares
  };
}

/*
=====================================================
VERCEL HANDLER
=====================================================
*/

module.exports =
  async function handler(
    request,
    response
  ) {

    try {

      const token =
        await getAccessToken();

      const settings =
        await getSettings(token);

      if (
        request.method === "GET"
      ) {

        let rows =
          await getAllRows(token);

        await releaseExpiredReservations(
          token,
          rows,
          settings.holdMinutes
        );

        rows =
          await getAllRows(token);

        return response
          .status(200)
          .json({
            success: true,
            settings,
            squares:
              rowsToPublicSquares(
                rows
              )
          });
      }

      if (
        request.method === "POST"
      ) {

        const body =
          request.body || {};

        if (
          body.action ===
          "reserveSquares"
        ) {
          return response
            .status(200)
            .json(
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
          return response
            .status(200)
            .json(
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
          return response
            .status(200)
            .json(
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
          return response
            .status(200)
            .json(
              await savePaymentMethod(
                token,
                body.data
              )
            );
        }

        return response
          .status(400)
          .json({
            success: false,
            message:
              "Invalid API action."
          });
      }

      return response
        .status(405)
        .json({
          success: false,
          message:
            "Method not allowed."
        });

    } catch (error) {

      console.error(
        "Season-Long API error:",
        error
      );

      return response
        .status(500)
        .json({
          success: false,
          message:
            error?.message ||
            String(error)
        });
    }
  };
