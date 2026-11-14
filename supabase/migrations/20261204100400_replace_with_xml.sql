-- P2-7 S5 (docs/plans/2026-11-14-p2-7-xml-invoice-upload.md section 3.5.3, 5 S5): public.review_replace_with_xml(p_xml, p_other), the "use the XML file instead of the PDF" tap.
--
-- Allowed only when p_xml is an XML invoice in status duplicate, p_other is a non-XML invoice (a photo or PDF) still in review, and p_other is an undeclared look-alike of p_xml (the
-- same predicate as the duplicate banner, app.is_undeclared_look_alike). Then, in ONE transaction: p_other is rejected through the unchanged reject_invoice (reason "Sostituita dal
-- file XML"), p_xml goes to review, or stays a duplicate of another live look-alike when there is one (the owner decides that pair separately), the supplier link and the article mapping
-- are run again (app.automap_invoice, unchanged; the mapping done on the photo copy is not copied line by line), and the audit row invoice.replaced_by_xml names the other invoice
-- (the action is in audit_event_action_check since 20261204100300). Against an approved photo there is no replace: the XML invoice is rejected by the owner and stays archived.
-- A second call finds p_other rejected and writes nothing (replace_not_allowed).
--
-- Both invoices are locked FOR NO KEY UPDATE in id order, so a concurrent approve_invoice of p_other either commits first (then this refuses: p_other is approved) or waits (then
-- approve_invoice refuses: p_other is rejected); never both an approved photo and a reviewable XML invoice (scripts/test-db-races.sh, case replace-vs-approve).
-- Errors: not_found (P0002, also another tenant's id), replace_not_allowed (P0001), 42501 for anyone but owner and admin (the gate). Definer, empty search_path, authenticated only.
create function public.review_replace_with_xml(p_xml uuid, p_other uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  x public.invoice;
  o public.invoice;
  v_next uuid;
  v_status public.invoice_status;
begin
  perform app.require_invoice_reviewer();
  v_tenant := (select app.tenant_id());
  if p_xml is null or p_other is null or p_xml = p_other then
    raise exception 'replace_not_allowed' using errcode = 'P0001';
  end if;

  -- Both rows, locked in id order (two concurrent calls on the same pair cannot deadlock), in the caller's tenant only.
  if p_xml < p_other then
    select * into x from public.invoice i where i.id = p_xml and i.tenant_id = v_tenant for no key update;
    select * into o from public.invoice i where i.id = p_other and i.tenant_id = v_tenant for no key update;
  else
    select * into o from public.invoice i where i.id = p_other and i.tenant_id = v_tenant for no key update;
    select * into x from public.invoice i where i.id = p_xml and i.tenant_id = v_tenant for no key update;
  end if;
  if x.id is null or o.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if x.document_type is null or x.status <> 'duplicate'
     or o.document_type is not null or o.status <> 'review'
     or not app.is_undeclared_look_alike(x.id, o.id) then
    raise exception 'replace_not_allowed' using errcode = 'P0001';
  end if;

  perform public.reject_invoice(o.id, 'Sostituita dal file XML');

  v_next := app.undeclared_look_alike(x.id);
  v_status := case when v_next is not null then 'duplicate' else 'review' end;
  update public.invoice set status = v_status, duplicate_of = v_next where id = x.id;

  perform app.automap_invoice(x.id);

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
    values (v_tenant, 'invoice', x.id, 'invoice.replaced_by_xml',
            jsonb_build_object('status', x.status, 'duplicate_of', x.duplicate_of), jsonb_build_object('other', o.id), (select app.app_user_id()));

  return jsonb_build_object('status', v_status);
end
$$;
revoke all on function public.review_replace_with_xml(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.review_replace_with_xml(uuid, uuid) to authenticated;
