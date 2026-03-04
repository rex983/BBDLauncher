import { generateIdpMetadata } from "@/lib/saml/metadata";
import { NextResponse } from "next/server";

export async function GET() {
  const metadata = generateIdpMetadata();
  return new NextResponse(metadata, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
