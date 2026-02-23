// Web-only page — excluded from Tauri static export build (see build:tauri script).
// In Tauri, history detail is rendered inline in /history via ?id= search param.
import RunDetailClient from "./RunDetailClient";

export default async function RunDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return <RunDetailClient id={id} />;
}
