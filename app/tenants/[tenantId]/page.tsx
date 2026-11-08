import RentFlowWorkspace from '@/components/RentFlowWorkspace';

export default async function TenantProfilePage({
  params,
}: {
  params: Promise<{ tenantId: string }> | { tenantId: string };
}) {
  const resolved = await Promise.resolve(params);
  return <RentFlowWorkspace initialTab="tenants" initialTenantId={resolved.tenantId} />;
}
