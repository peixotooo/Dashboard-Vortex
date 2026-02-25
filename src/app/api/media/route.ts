import { NextRequest, NextResponse } from "next/server";
import { uploadAdImage } from "@/lib/meta-api";
import { getAuthenticatedContext, handleAuthError } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
    try {
        await getAuthenticatedContext(request).catch(() => { });

        const formData = await request.formData();
        const result = await uploadAdImage(formData);

        return NextResponse.json(result);
    } catch (error) {
        return handleAuthError(error);
    }
}
