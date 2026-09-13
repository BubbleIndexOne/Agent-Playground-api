import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, INestApplication } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import serverlessExpress from '@codegenie/serverless-express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { APP_CONSTANTS, AUTH_CONSTANTS } from './common/constants';

let cachedHandler: any;

/**
 * Applies global filters, pipes, CORS, and Swagger documentation to NestJS instance
 */
function configureApp(app: INestApplication): void {
  app.enableCors();
  app.useGlobalFilters(new AllExceptionsFilter());
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

  const swaggerConfig = new DocumentBuilder()
    .setTitle(APP_CONSTANTS.SWAGGER_TITLE)
    .setDescription(APP_CONSTANTS.SWAGGER_DESCRIPTION)
    .setVersion(APP_CONSTANTS.SWAGGER_VERSION)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter your Bearer access token',
        in: 'header',
      },
      AUTH_CONSTANTS.BEARER_AUTH_SCHEME_NAME,
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(APP_CONSTANTS.SWAGGER_DOCS_PATH, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });
}

async function bootstrapServer() {
  const expressApp = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));
  configureApp(app);
  await app.init();
  return serverlessExpress({ app: expressApp });
}

// Cloudflare Worker Fetch Handler
export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    // Inject Cloudflare Worker bindings into process.env so NestJS ConfigService
    // and DatabaseService can read them without any fs/path usage.
    // This must happen BEFORE bootstrapServer() so onModuleInit picks them up.
    if (env?.HYPERDRIVE?.connectionString) {
      process.env.DATABASE_URL = env.HYPERDRIVE.connectionString;
    }
    if (env?.SUPABASE_URL) {
      process.env.SUPABASE_URL = env.SUPABASE_URL;
    }
    if (env?.SUPABASE_SERVICE_ROLE_KEY) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    }

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
