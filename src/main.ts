import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import serverlessExpress from '@codegenie/serverless-express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

let cachedHandler: any;

async function bootstrapServer() {
  const expressApp = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));

  // Enable CORS
  app.enableCors();

  // Global Exception Filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger Documentation Configuration
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Agent Playground Backend API')
    .setDescription(
      'API documentation for Agent Playground backend service (Milestone S1: Authentication)',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter your Bearer access token',
        in: 'header',
      },
      'bearer',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.init();
  return serverlessExpress({ app: expressApp });
}

// Local standalone execution (npm run dev / node dist/main.js)
if (
  typeof process !== 'undefined' &&
  process.env &&
  process.env.NODE_ENV !== 'worker' &&
  !process.env.CF_PAGES &&
  require.main === module
) {
  (async () => {
    const logger = new Logger('Bootstrap');
    const app = await NestFactory.create(AppModule);
    app.enableCors();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Agent Playground Backend API')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'bearer')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    const port = process.env.PORT || 3000;
    await app.listen(port);
    logger.log(`Server is running on http://localhost:${port}`);
    logger.log(`Swagger docs at http://localhost:${port}/api/docs`);
  })();
}

// Cloudflare Worker Fetch Handler
export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    if (!cachedHandler) {
      cachedHandler = await bootstrapServer();
    }

    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((val, key) => {
      headers[key.toLowerCase()] = val;
    });

    const body =
      request.method !== 'GET' && request.method !== 'HEAD' && request.body
        ? await request.text()
        : undefined;

    const event = {
      version: '2.0',
      routeKey: '$default',
      rawPath: url.pathname,
      rawQueryString: url.search.replace(/^\?/, ''),
      headers,
      requestContext: {
        http: {
          method: request.method,
          path: url.pathname,
          protocol: 'HTTP/1.1',
          sourceIp: headers['cf-connecting-ip'] || '127.0.0.1',
          userAgent: headers['user-agent'] || '',
        },
      },
      body,
      isBase64Encoded: false,
    };

    const response = await cachedHandler(event, ctx);

    return new Response(
      response.isBase64Encoded
        ? Buffer.from(response.body, 'base64')
        : response.body,
      {
        status: response.statusCode,
        headers: response.headers,
      },
    );
  },
};
