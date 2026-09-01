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
