const { swapTokens } = require('./swapCreator');
const { Connection } = require('@solana/web3.js');
const { Liquidity } = require('@raydium-io/raydium-sdk-v2');
require('dotenv').config();

class SniperManager {
    static activeSnipers = new Map();
    static connection = new Connection(process.env.SOLANA_WS_URL || 'https://api.mainnet-beta.solana.com');

    static async addSniper(config) {
        try {
            try {
                await swapTokens({
                    tokenId: config.tokenId, // Use document ID here
                    amountSpecified: config.buyAmount,
                    swapBaseIn: true
                });
            } catch (error) {
                console.error(`[Sniper] Setup failed:`, error);
            }


            console.log(`[Sniper] Initializing for token: ${config.targetToken}`);

            // Immediate buy
            await this.executeBuy(config);

            // Start price monitoring
            const monitor = setInterval(async () => {
                try {
                    const shouldSell = await this.checkSellCondition(config);
                    if (shouldSell) {
                        await this.executeSell(config);
                        clearInterval(monitor);
                        this.activeSnipers.delete(config.targetToken);
                    }
                } catch (error) {
                    console.error(`[Sniper] Monitoring error:`, error);
                }
            }, 3000); // Check every 3 seconds

            this.activeSnipers.set(config.targetToken, {
                config,
                interval: monitor
            });

        } catch (error) {
            console.error('[Sniper] Setup failed:', error);
            throw error;
        }
    }

    static async executeBuy(config) {
        try {
            console.log(`[Sniper] Buying ${config.buyAmount} of ${config.targetToken}`);
            await swapTokens({
                tokenId: config.tokenId, // MongoDB document ID
                amountSpecified: config.buyAmount,
                swapBaseIn: true
            });
        } catch (error) {
            console.error('[Sniper] Buy failed:', error);
            throw error;
        }
    }

    static async checkSellCondition(config) {
        // Implement your price check logic here
        // Example: Compare against config.sellTargetPrice
        return false; // Temporary placeholder
    }

    static async executeSell(config) {
        console.log(`[Sniper] Selling ${config.targetToken}`);
        // Implement sell logic
    }

    static stopAll() {
        this.activeSnipers.forEach(sniper => {
            clearInterval(sniper.interval);
        });
        this.activeSnipers.clear();
    }
}

module.exports = SniperManager;