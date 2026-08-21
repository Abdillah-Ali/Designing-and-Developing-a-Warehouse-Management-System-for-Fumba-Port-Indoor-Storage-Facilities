-- Revoke legacy manual invoice creation, issuance, and payment confirmation permissions from Finance Officer.
DELETE FROM role_permissions rp USING roles r
WHERE rp.role_id = r.id
  AND r.role_name = 'Finance Officer'
  AND rp.permission_key IN (
    'finance.invoices.create',
    'finance.invoices.issue',
    'finance.payments.confirm'
  );
