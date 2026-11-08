import RentFlowWorkspace from '@/components/RentFlowWorkspace';

export default function TenantProfilePage({
  params,
}: {
  params: { tenantId: string };
}) {
  return <RentFlowWorkspace initialTab="tenants" initialTenantId={params?.tenantId || 'T-01'} />;
}
