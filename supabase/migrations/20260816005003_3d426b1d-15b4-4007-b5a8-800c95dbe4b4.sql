GRANT SELECT ON public.gateway_connections TO authenticated;

CREATE POLICY "Session owners and admins can read gateway state"
  ON public.gateway_connections FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = gateway_connections.session_id
        AND (s.user_id = auth.uid() OR (app_private.is_admin(auth.uid()) AND s.tenant_id = app_private.current_tenant()))
    )
  );