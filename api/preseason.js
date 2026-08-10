import crypto from "crypto";

const HOLD_MINUTES = 15;
const PRICE_PER_SQUARE = 10;
const SHEET_NAME = "Squares";

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

  const credentials =
    JSON.parse(raw);

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
    iss: credentials.client_email,
    scope:
      "https://www.googleapis.com/auth/spreadsheets",
    aud:
      "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
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
      key: credentials.private_key,
      format: "pem"
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
              "urn:ietf:params:oauth-grant-type:jwt-bearer",
            assertion: jwt
          })
      }
    );

  let data =
    await response.json();

  /*
    Google requires this exact grant type.
    If the abbreviated value above is rejected,
    retry with the official OAuth value.
  */
  if (!response.ok) {
    const retry =
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
              assertion: jwt
            })
        }
      );

    data =
      await retry.json();

    if (
      !retry.ok ||
      !data.access_token
    ) {
      throw new Error(
        data.error_description ||
        "Google authentication failed."
      );
    }
  }

  if (!data.access_token) {
    throw new Error(
      "Google did not return an access token."
    );
  }

  return data.access_token;
}

function getSpreadsheetId() {
  const id =
    process.env
      .PRESEASON_SPREADSHEET_ID;

  if (!id) {
    throw new Error(
      "PRESEASON_SPREADSHEET_ID is missing."
    );
  }

  return id;
}

async function getAllRows(
  token
) {
  const spreadsheetId =
    getSpreadsheetId();

  const range =
    encodeURIComponent(
      `${SHEET_NAME}!A2:L101`
    );

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/` +
    `${spreadsheetId}/values/${range}`;

  const response =
    await fetch(url, {
      headers: {
        Authorization:
          `Bearer ${token}`
      },

      cache: "no-store"
    });

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      "Could not read the football squares sheet."
    );
  }

  const rows =
    data.values || [];

  /*
    Guarantee 100 rows in memory.
  */
  const normalized = [];

  for (
    let index = 0;
    index < 100;
    index++
  ) {
    const source =
      rows[index] || [];

    normalized.push([
      source[0] || String(index + 1),
      source[1] || "Available",
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

  return normalized;
}

function normalizeStatus(
  value
) {
  const status =
    String(
      value || ""
    )
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

function parseReservedDate(
  value
) {
  if (!value) {
    return null;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
}

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
    `https://sheets.googleapis.com/v4/spreadsheets/` +
    `${spreadsheetId}/values:batchUpdate`;

  const response =
    await fetch(url, {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${token}`,

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
    });

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

async function releaseExpiredReservations(
  token,
  rows
) {
  const now =
    Date.now();

  const updates = [];

  rows.forEach(
    function(row, index) {
      const status =
        normalizeStatus(
          row[1]
        );

      if (
        status !== "Pending"
      ) {
        return;
      }

      const reservedAt =
        parseReservedDate(
          row[5]
        );

      if (!reservedAt) {
        return;
      }

      const minutesPassed =
        (
          now -
          reservedAt.getTime()
        ) / 60000;

      if (
        minutesPassed <
        HOLD_MINUTES
      ) {
        return;
      }

      /*
        Reset B:L.
      */
      row[1] = "Available";

      for (
        let column = 2;
        column <= 11;
        column++
      ) {
        row[column] = "";
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

function rowsToPublicSquares(
  rows
) {
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

function normalizeSquareList(
  values
) {
  if (
    !Array.isArray(values)
  ) {
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

  if (
    squares.length === 0
  ) {
    throw new Error(
      "Please select at least one square."
    );
  }

  return squares;
}

async function reserveSquares(
  token,
  formData
) {
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

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
      .test(email)
  ) {
    throw new Error(
      "Please enter a valid email address."
    );
  }

  let rows =
    await getAllRows(
      token
    );

  await releaseExpiredReservations(
    token,
    rows
  );

  /*
    Read once more after releasing
    anything that expired.
  */
  rows =
    await getAllRows(
      token
    );

  const unavailable = [];

  squares.forEach(
    function(squareNumber) {
      const row =
        rows[
          squareNumber - 1
        ];

      if (
        normalizeStatus(
          row[1]
        ) !==
        "Available"
      ) {
        unavailable.push(
          squareNumber
        );
      }
    }
  );

  if (
    unavailable.length > 0
  ) {
    throw new Error(
      "These squares are no longer available: " +
      unavailable.join(", ") +
      ". Please choose again."
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
    squares: squares,
    name: name,
    email: email,
    phone: phone,
    quantity:
      squares.length,

    pricePerSquare:
      PRICE_PER_SQUARE,

    total:
      squares.length *
      PRICE_PER_SQUARE,

    expiresInMinutes:
      HOLD_MINUTES,

    reservationId:
      reservationId
  };
}

/*
=====================================================
PAYPAL
=====================================================
*/

async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials are missing.");
  }

  const authorization = Buffer
    .from(clientId + ":" + clientSecret)
    .toString("base64");

  const response = await fetch(
    "https://api-m.paypal.com/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + authorization,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error("PayPal authentication failed.");
  }

  return data.access_token;
}


async function getPayPalOrder(orderId) {
  const accessToken = await getPayPalAccessToken();

  const response = await fetch(
    "https://api-m.paypal.com/v2/checkout/orders/" +
      encodeURIComponent(orderId),
    {
      headers: {
        Authorization: "Bearer " + accessToken,
        Accept: "application/json"
      },
      cache: "no-store"
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error("PayPal could not verify this order.");
  }

  return data;
}


async function confirmPayPalPayment(googleToken, paymentData) {
  const orderId = String(paymentData?.orderId || "").trim();
  const email = String(paymentData?.email || "")
    .trim()
    .toLowerCase();

  const squares = normalizeSquareList(paymentData?.squares);

  if (!orderId || !email) {
    throw new Error("Payment information is incomplete.");
  }

  const rows = await getAllRows(googleToken);

  const alreadyRecorded = rows.some(
    row => String(row[8] || "") === orderId
  );

  if (alreadyRecorded) {
    return {
      success: true,
      alreadyProcessed: true
    };
  }

  squares.forEach(squareNumber => {
    const row = rows[squareNumber - 1];

    if (normalizeStatus(row[1]) !== "Pending") {
      throw new Error(
        "Square " + squareNumber + " is no longer pending."
      );
    }

    if (
      String(row[3] || "").trim().toLowerCase() !== email
    ) {
      throw new Error(
        "The reservation email does not match."
      );
    }
  });

  const expectedTotal = squares.length * PRICE_PER_SQUARE;

  const paypalOrder = await getPayPalOrder(orderId);

  if (
    String(paypalOrder.status || "").toUpperCase() !== "COMPLETED"
  ) {
    throw new Error("The PayPal payment is not completed.");
  }

  const purchaseUnits = Array.isArray(paypalOrder.purchase_units)
    ? paypalOrder.purchase_units
    : [];

  let paidTotal = 0;

  purchaseUnits.forEach(unit => {
    const captures = unit?.payments?.captures;

    if (!Array.isArray(captures)) return;

    captures.forEach(capture => {
      if (
        String(capture.status || "").toUpperCase() === "COMPLETED"
      ) {
        if (
          String(capture?.amount?.currency_code || "").toUpperCase() !==
          "USD"
        ) {
          throw new Error(
            "The PayPal payment currency is incorrect."
          );
        }

        paidTotal += Number(capture?.amount?.value || 0);
      }
    });
  });

  if (
    Math.round(paidTotal * 100) !==
    Math.round(expectedTotal * 100)
  ) {
    throw new Error(
      "The PayPal payment amount does not match the reservation."
    );
  }

  const paymentDate = new Date().toISOString();
  const updates = [];

  squares.forEach(squareNumber => {
    const row = rows[squareNumber - 1];
    const sheetRow = squareNumber + 1;

    updates.push({
      range: `${SHEET_NAME}!B${sheetRow}:L${sheetRow}`,
      values: [[
        "Sold",
        row[2] || "",
        row[3] || "",
        row[4] || "",
        row[5] || "",
        "PayPal",
        "Paid",
        orderId,
        PRICE_PER_SQUARE,
        paymentDate,
        row[11] || ""
      ]]
    });
  });

  await batchUpdateRows(googleToken, updates);

  return {
    success: true,
    squares,
    amount: expectedTotal,
    orderId
  };
}
async function savePaymentMethod(
  googleToken,
  paymentData
) {
  const email =
    String(
      paymentData?.email || ""
    )
      .trim()
      .toLowerCase();

  const paymentMethod =
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
    paymentMethod !== "zeffy" &&
    paymentMethod !== "venmo"
  ) {
    throw new Error(
      "That payment method is not valid."
    );
  }

  if (!email) {
    throw new Error(
      "Reservation email is missing."
    );
  }

  const rows =
    await getAllRows(
      googleToken
    );

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

      const reservedEmail =
        String(
          row[3] || ""
        )
          .trim()
          .toLowerCase();

      if (
        reservedEmail !== email
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
          paymentMethod === "zeffy"
            ? "Zeffy"
            : "Venmo",

          "Payment Pending"
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
    paymentMethod:
      paymentMethod,
    squares:
      squares
  };
}

export default {
  async fetch(request) {
    try {
      const token =
        await getAccessToken();

      if (
        request.method === "GET"
      ) {
        const rows =
          await getAllRows(
            token
          );

        await releaseExpiredReservations(
          token,
          rows
        );

        const refreshedRows =
          await getAllRows(
            token
          );

        return Response.json({
          success: true,
          squares:
            rowsToPublicSquares(
              refreshedRows
            )
        });
      }

      if (
        request.method === "POST"
      ) {
        const body =
          await request.json();

        if (
          body.action ===
          "reserveSquares"
        ) {
          const result =
            await reserveSquares(
              token,
              body.data
            );

          return Response.json(
            result
          );
        }
if (
  body.action ===
  "confirmPayPalPayment"
) {
  const result =
    await confirmPayPalPayment(
      token,
      body.data
    );

  return Response.json(
    result
  );
}
        return Response.json(
          {
            success: false,
            message:
              "Invalid API action."
          },
          { status: 400 }
        );
      }

      return Response.json(
        {
          success: false,
          message:
            "Method not allowed."
        },
        { status: 405 }
      );

    } catch (error) {
      return Response.json(
        {
          success: false,
          message:
            error?.message ||
            String(error)
        },
        { status: 500 }
      );
    }
  }
};
