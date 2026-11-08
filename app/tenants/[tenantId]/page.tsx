import RentFlowWorkspace from '@/components/RentFlowWorkspace';

export default async function TenantProfilePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  return <RentFlowWorkspace initialTab="tenants" initialTenantId={tenantId} />;
}
