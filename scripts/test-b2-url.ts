
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

function getPublicUrl(key: string): string {
    const downloadUrl = process.env.B2_DOWNLOAD_URL;
    if (downloadUrl) {
        return `${downloadUrl.replace(/\/$/, "")}/${key}`;
    }

    const endpoint = process.env.B2_ENDPOINT || "";
    const bucket = process.env.B2_BUCKET_NAME || "my-bucket";
    
    if (endpoint.includes("backblazeb2.com")) {
        const host = endpoint.replace(/^https?:\/\//, "");
        return `https://${bucket}.${host}/${key}`;
    }

    return `${endpoint}/${bucket}/${key}`;
}

const testKey = "creatives/test-video.mp4";
console.log("--- B2 URL Generation Test ---");
console.log("B2_ENDPOINT:", process.env.B2_ENDPOINT);
console.log("B2_BUCKET_NAME:", process.env.B2_BUCKET_NAME);
console.log("B2_DOWNLOAD_URL:", process.env.B2_DOWNLOAD_URL);
console.log("Generated URL:", getPublicUrl(testKey));
console.log("------------------------------");
