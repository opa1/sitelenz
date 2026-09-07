import { Module } from '@nestjs/common';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { ExactAvmScheme } from '@x402/avm/exact/server';
import { AppConfigService } from '../config';
import {
  ALGORAND_MAINNET_NETWORK,
  ALGORAND_TESTNET_NETWORK,
  X402_RESOURCE_SERVER,
} from './x402.constants';
import { X402Guard } from './x402.guard';

/**
 * Algorand Global x402 Challenge compliance - researched against the real
 * packages and the live GoPlausible facilitator (facilitator.goplausible.xyz)
 * rather than guessed:
 *
 * 1. Challenge tag ("x402-global-challenge"): @x402/core's `ResourceConfig`
 *    (the input to `buildPaymentRequirements`) has no dedicated `tags` or
 *    `metadata` field - its only free-form field is `extra`, which is what
 *    the AVM scheme copies verbatim onto each built `PaymentRequirements`.
 *    Fetching the facilitator's own live discovery catalog
 *    (`GET /discovery/resources`) turned up an already-registered resource
 *    (onestepchess.xyz) whose payment requirement carries
 *    `accepts[0].extra.tag: "x402-global-challenge"` - i.e. the facilitator
 *    reads the leaderboard tag from `extra.tag`. X402Guard sets exactly that
 *    on the `ResourceConfig.extra` it builds.
 *
 * 2. Bazaar / discovery listing: the facilitator has no registration
 *    endpoint. Its OpenAPI spec (`GET /docs/openapi.json`) documents
 *    `GET /discovery/resources` as "x402-enabled API resources
 *    auto-cataloged from payment flows" - listing is fully automatic once a
 *    real payment is verified/settled against this facilitator, driven by
 *    the `resource` (url/description/mimeType) the client echoes back from
 *    our 402 response. No header, endpoint, or separate registration call
 *    exists to implement. X402Guard already supplies `resourceInfo`
 *    (url/description/mimeType) to `createPaymentRequiredResponse`, and
 *    `url` is now built as an absolute URL (see main.ts's `trustProxy`)
 *    since every cataloged entry observed live uses a full https:// URL.
 */
@Module({
  providers: [
    {
      provide: X402_RESOURCE_SERVER,
      useFactory: async (appConfigService: AppConfigService) => {
        const facilitatorClient = new HTTPFacilitatorClient({
          url: appConfigService.x402FacilitatorUrl,
        });
        const resourceServer = new x402ResourceServer(facilitatorClient);
        const network =
          appConfigService.network === 'mainnet'
            ? ALGORAND_MAINNET_NETWORK
            : ALGORAND_TESTNET_NETWORK;
        resourceServer.register(network, new ExactAvmScheme());
        await resourceServer.initialize();
        return resourceServer;
      },
      inject: [AppConfigService],
    },
    X402Guard,
  ],
  exports: [X402Guard, X402_RESOURCE_SERVER],
})
export class X402Module {}
