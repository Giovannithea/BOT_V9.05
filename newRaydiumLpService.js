require('dotenv').config();
const { Connection, PublicKey } = require('@solana/web3.js');
const { Liquidity } = require('@raydium-io/raydium-sdk-v2');
const { MongoClient, ObjectId } = require('mongodb');

let db;

async function connectToDatabase() {
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    db = client.db("bot");
    return db;
}

async function processRaydiumLpTransaction(connection, signature) {
    try {
        if (!db) await connectToDatabase();

        const tx = await connection.getTransaction(signature, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed'
        });

        // Parse pool data using Raydium V2 SDK
        const events = Liquidity.parseTransactionEvents({
            transaction: tx,
            programId: new PublicKey(process.env.RAYDIUM_AMM_PROGRAM_ID)
        });

        const poolCreationEvent = events.find(e => e.type === 'initializePool');
        if (!poolCreationEvent) return null;

        const poolKeys = Liquidity.parsePoolKeysFromJson({
            id: poolCreationEvent.id.toString(),
            baseMint: poolCreationEvent.baseMint.toString(),
            quoteMint: poolCreationEvent.quoteMint.toString(),
            baseDecimals: poolCreationEvent.baseDecimals,
            quoteDecimals: poolCreationEvent.quoteDecimals,
            lpMint: poolCreationEvent.lpMint.toString(),
            programId: process.env.RAYDIUM_AMM_PROGRAM_ID,
            authority: poolCreationEvent.authority.toString(),
            openOrders: poolCreationEvent.openOrders.toString(),
            targetOrders: poolCreationEvent.targetOrders.toString(),
            baseVault: poolCreationEvent.baseVault.toString(),
            quoteVault: poolCreationEvent.quoteVault.toString(),
            marketProgramId: poolCreationEvent.marketProgramId.toString(),
            marketId: poolCreationEvent.marketId.toString(),
            marketBids: poolCreationEvent.marketBids.toString(),
            marketAsks: poolCreationEvent.marketAsks.toString(),
            marketEventQueue: poolCreationEvent.marketEventQueue.toString(),
            marketBaseVault: poolCreationEvent.marketBaseVault.toString(),
            marketQuoteVault: poolCreationEvent.marketQuoteVault.toString(),
            marketAuthority: poolCreationEvent.marketAuthority.toString()
        });

        // Build document with all required V2 fields
        const doc = {
            ammId: poolKeys.id.toString(),
            baseMint: poolKeys.baseMint.toString(),
            quoteMint: poolKeys.quoteMint.toString(),
            tokenAddress: poolKeys.baseMint.toString(), // Critical fix: Added tokenAddress
            baseDecimals: poolKeys.baseDecimals,
            quoteDecimals: poolKeys.quoteDecimals,
            ammAuthority: poolKeys.authority.toString(),
            ammOpenOrders: poolKeys.openOrders.toString(),
            targetOrders: poolKeys.targetOrders.toString(),
            baseVault: poolKeys.baseVault.toString(),
            quoteVault: poolKeys.quoteVault.toString(),
            marketProgramId: poolKeys.marketProgramId.toString(),
            marketId: poolKeys.marketId.toString(),
            marketBids: poolKeys.marketBids.toString(),
            marketAsks: poolKeys.marketAsks.toString(),
            marketEventQueue: poolKeys.marketEventQueue.toString(),
            marketBaseVault: poolKeys.marketBaseVault.toString(),
            marketQuoteVault: poolKeys.marketQuoteVault.toString(),
            marketAuthority: poolKeys.marketAuthority.toString(),
            lpMint: poolKeys.lpMint.toString(),
            programId: poolKeys.programId.toString(),
            signature: signature,
            timestamp: new Date()
        };

        // Insert into MongoDB
        const result = await db.collection("raydium_lp_transactionsV3").insertOne(doc);

        // Return document with both _id and tokenAddress
        return {
            ...doc,
            _id: result.insertedId,
            tokenAddress: doc.tokenAddress // Ensure tokenAddress is included
        };

    } catch (error) {
        console.error('[LP Service] Processing failed:', error.message);
        throw error;
    }
}

module.exports = {
    processRaydiumLpTransaction,
    connectToDatabase
};