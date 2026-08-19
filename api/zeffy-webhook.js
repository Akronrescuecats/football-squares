export default {

  async fetch(request) {

    /*
    =====================================================
    ZEFFY WEBHOOK RECEIVER - TEST MODE
    =====================================================

    This version DOES NOT change any football squares.

    It only receives the Zeffy webhook and logs the
    payload so we can see exactly what Zeffy sends.
    =====================================================
    */

    if (request.method !== "POST") {

      return Response.json(
        {
          success: true,
          message:
            "Zeffy webhook endpoint is active."
        },
        {
          status: 200
        }
      );
    }


    try {

      const body =
        await request.json();


      console.log(
        "ZEFFY WEBHOOK RECEIVED:"
      );

      console.log(
        JSON.stringify(
          body,
          null,
          2
        )
      );


      /*
      Do NOT update Google Sheets yet.

      We first need to inspect one real
      payment.completed payload.
      */


      return Response.json(
        {
          success: true,
          received: true
        },
        {
          status: 200
        }
      );


    } catch (error) {

      console.error(
        "ZEFFY WEBHOOK ERROR:",
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
          status: 400
        }
      );
    }
  }
};
