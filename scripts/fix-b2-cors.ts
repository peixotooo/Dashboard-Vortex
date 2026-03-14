
import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function setCors() {
    // Using hardcoded values provided by user for immediate fix
    const endpoint = "https://s3.us-east-005.backblazeb2.com";
    const keyId = "0058db4cd5d97e40000000002";
    const appKey = "K005CFohW4D4FUDVjQJY9hMPJjMyYto";
    const bucket = "Dash-Vortex";

    console.log(`Targeting Bucket: ${bucket}`);
    console.log(`Endpoint: ${endpoint}`);

    const client = new S3Client({
        endpoint: endpoint,
        region: process.env.B2_REGION || "auto",
        forcePathStyle: true,
        credentials: {
            accessKeyId: keyId,
            secretAccessKey: appKey,
        },
    });

    const corsConfig = {
        Bucket: bucket,
        CORSConfiguration: {
            CORSRules: [
                {
                    AllowedHeaders: ["*"],
                    AllowedMethods: ["PUT", "POST", "GET"],
                    AllowedOrigins: ["*"], // Using wildcard for total verification
                    ExposeHeaders: ["ETag"],
                    MaxAgeSeconds: 3600,
                },
            ],
        },
    };

    try {
        await client.send(new PutBucketCorsCommand(corsConfig));
        console.log("SUCCESS: CORS policy applied to bucket.");
    } catch (err: any) {
        console.error("ERROR applying CORS:", err.message);
        if (err.Code === "SignatureDoesNotMatch") {
            console.error("Check your B2_KEY_ID and B2_APPLICATION_KEY");
        }
    }
}

setCors();
