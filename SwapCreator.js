const { Connection, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram, Keypair, SystemProgram } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createCloseAccountInstruction, getOrCreateAssociatedTokenAccount } = require("@solana/spl-token");
const { Liquidity, Token, TokenAmount, WSOL } = require("@raydium-io/raydium-sdk");
const { MongoClient, ObjectId } = require("mongodb");
const bs58 = require('bs58');
require("dotenv").config();

// Initialize connection
const connection = new Connection(process.env.SOLANA_WS_URL, "confirmed");
const RAYDIUM_AMM_PROGRAM_ID = new PublicKey(process.env.RAYDIUM_AMM_PROGRAM_ID);
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// MongoDB connection
let db;
async function connectToDatabase() {
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    db = client.db("bot");
    return db;
}

// Fetch complete pool data from MongoDB
// In SwapCreator.js
async function fetchTokenDataFromMongo(tokenId) {
    if (!db) await connectToDatabase();

    // Convert string ID to MongoDB ObjectId
    const document = await db.collection("raydium_lp_transactionsV3").findOne({
        _id: new ObjectId(tokenId) // ✅ Proper conversion
    });

    if (!document) throw new Error(`Token data not found for ID: ${tokenId}`);

    // Validate required fields (add missing ones)
    const requiredFields = [
        'ammId', 'ammAuthority', 'ammOpenOrders', 'baseMint', 'quoteMint',
        'baseVault', 'quoteVault', 'marketProgramId', 'marketId',
        'marketBids', 'marketAsks', 'marketEventQueue', 'marketAuthority' // Added
    ];

    const missingFields = requiredFields.filter(field => !document[field]);
    if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    return document;
}

// Create swap instruction using Raydium SDK V2
async function createSwapInstruction(tokenData, userKeys, amountIn) {
    try {
        const { poolKeys } = await Liquidity.makeSwapFixedInInstruction({
            poolKeys: {
                id: new PublicKey(tokenData.ammId),
                authority: new PublicKey(tokenData.ammAuthority),
                openOrders: new PublicKey(tokenData.ammOpenOrders),
                baseMint: new PublicKey(tokenData.baseMint),
                quoteMint: new PublicKey(tokenData.quoteMint),
                baseVault: new PublicKey(tokenData.tokenVault),
                quoteVault: new PublicKey(tokenData.solVault),
                marketProgramId: new PublicKey(tokenData.marketProgramId),
                marketId: new PublicKey(tokenData.marketId),
                marketBids: new PublicKey(tokenData.marketBids),
                marketAsks: new PublicKey(tokenData.marketAsks),
                marketEventQueue: new PublicKey(tokenData.marketEventQueue),
                marketBaseVault: new PublicKey(tokenData.marketBaseVault),
                marketQuoteVault: new PublicKey(tokenData.marketQuoteVault),
                marketAuthority: new PublicKey(tokenData.marketAuthority)
            },
            userKeys: {
                tokenAccountIn: new PublicKey(userKeys.tokenAccountIn),
                tokenAccountOut: new PublicKey(userKeys.tokenAccountOut),
                owner: userKeys.owner
            },
            amountIn: new TokenAmount(
                new Token(tokenData.programId, tokenData.baseMint, 9), // Adjust decimals as needed
                amountIn
            ).raw,
            fixedSide: "in"
        });

        return poolKeys;
    } catch (error) {
        console.error("Failed to create swap instruction:", error);
        throw error;
    }
}

// Main swap function
async function swapTokens({ tokenId, amountSpecified, swapBaseIn }) {
    const userOwner = Keypair.fromSecretKey(
        bs58.default.decode(process.env.WALLET_PRIVATE_KEY)
    );
    const userOwnerPublicKey = userOwner.publicKey;
    const tokenData = await fetchTokenDataFromMongo(tokenId);

    const preInstructions = [];
    const postInstructions = [];

    // Handle token accounts
    const inputMint = swapBaseIn ? tokenData.baseMint : tokenData.quoteMint;
    const outputMint = swapBaseIn ? tokenData.quoteMint : tokenData.baseMint;

    // Prepare input token account (WSOL for SOL swaps)
    let inputTokenAccount;
    if (inputMint === WSOL_MINT.toString()) {
        const wsolAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            userOwner,
            WSOL_MINT,
            userOwnerPublicKey
        );
        inputTokenAccount = wsolAccount.address;

        // Add transfer instruction for WSOL
        preInstructions.push(
            SystemProgram.transfer({
                fromPubkey: userOwnerPublicKey,
                toPubkey: inputTokenAccount,
                lamports: amountSpecified
            })
        );
    } else {
        inputTokenAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            userOwner,
            new PublicKey(inputMint),
            userOwnerPublicKey
        ).then(acc => acc.address);
    }

    // Prepare output token account
    const outputTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        userOwner,
        new PublicKey(outputMint),
        userOwnerPublicKey
    ).then(acc => acc.address);

    // Create swap instruction
    const swapIx = await createSwapInstruction(tokenData, {
        tokenAccountIn: inputTokenAccount.toString(),
        tokenAccountOut: outputTokenAccount.toString(),
        owner: userOwnerPublicKey
    }, amountSpecified);

    // Build transaction
    const tx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 })) // Priority fee
        .add(...preInstructions)
        .add(swapIx)
        .add(...postInstructions);

    try {
        const signature = await connection.sendTransaction(tx, [userOwner]);
        await connection.confirmTransaction(signature, "confirmed");

        // Log successful swap
        await db.collection("swapAttempts").insertOne({
            tokenId,
            amount: amountSpecified,
            direction: swapBaseIn ? "buy" : "sell",
            signature,
            timestamp: new Date(),
            status: "success",
            fee: tokenData.fee
        });

        return signature;
    } catch (error) {
        // Log failed swap
        await db.collection("swapAttempts").insertOne({
            tokenId,
            amount: amountSpecified,
            direction: swapBaseIn ? "buy" : "sell",
            error: error.message,
            timestamp: new Date(),
            status: "failed"
        });
        throw error;
    }
}

module.exports = {
    swapTokens,
    connectToDatabase
};