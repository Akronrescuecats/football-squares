export default {
  async fetch(request) {
    const SCRIPT_URL = process.env.PRESEASON_SCRIPT_URL;

    if (!SCRIPT_URL) {
      return Response.json(
        {
          success: false,
          message: 'PRESEASON_SCRIPT_URL is missing.'
        },
        { status: 500 }
      );
    }

    try {
      const url = new URL(request.url);

      if (request.method === 'GET') {
        const action =
          url.searchParams.get('action') || 'getSquares';

        const googleUrl =
          SCRIPT_URL +
          '?action=' +
          encodeURIComponent(action);

        const googleResponse = await fetch(googleUrl, {
          redirect: 'follow'
        });

        const text = await googleResponse.text();

        try {
          const data = JSON.parse(text);

          return Response.json(data, {
            status: 200
          });
        } catch (error) {
          return Response.json(
            {
              success: false,
              message: 'Google returned an invalid response.',
              googleStatus: googleResponse.status,
              contentType:
                googleResponse.headers.get('content-type'),
              first500Characters:
                text.substring(0, 500)
            },
            { status: 502 }
          );
        }
      }

      if (request.method === 'POST') {
        const body = await request.text();

        const googleResponse = await fetch(SCRIPT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },
          body: body,
          redirect: 'follow'
        });

        const text = await googleResponse.text();

        try {
          const data = JSON.parse(text);

          return Response.json(data, {
            status: 200
          });
        } catch (error) {
          return Response.json(
            {
              success: false,
              message: 'Google returned an invalid response.',
              googleStatus: googleResponse.status,
              contentType:
                googleResponse.headers.get('content-type'),
              first500Characters:
                text.substring(0, 500)
            },
            { status: 502 }
          );
        }
      }

      return Response.json(
        {
          success: false,
          message: 'Method not allowed.'
        },
        { status: 405 }
      );

    } catch (error) {
      return Response.json(
        {
          success: false,
          message:
            error && error.message
              ? error.message
              : String(error)
        },
        { status: 500 }
      );
    }
  }
};
