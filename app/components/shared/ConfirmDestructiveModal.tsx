interface ConfirmDestructiveModalProps {
  id: string;
  heading: string;
  message: string;
  confirmLabel: string;
  triggerLabel: string;
  /** POST action URL for the confirm submit. */
  formAction: string;
  triggerVariant?: "primary" | "secondary" | "tertiary";
  disabled?: boolean;
}

// Polaris web components expose modal show/hide via command/commandFor.
// Confirm uses a hidden form + requestSubmit — associating via the HTML
// `form` attribute on s-button was unreliable and hid the primary action.
export function ConfirmDestructiveModal({
  id,
  heading,
  message,
  confirmLabel,
  triggerLabel,
  formAction,
  triggerVariant = "secondary",
  disabled = false,
}: ConfirmDestructiveModalProps) {
  const formId = `${id}-form`;

  return (
    <>
      <s-button
        command="--show"
        commandFor={id}
        variant={triggerVariant}
        tone="critical"
        disabled={disabled}
      >
        {triggerLabel}
      </s-button>

      <form id={formId} method="post" action={formAction} hidden />

      <s-modal id={id} heading={heading}>
        <s-paragraph>{message}</s-paragraph>
        <s-button
          slot="primary-action"
          tone="critical"
          variant="primary"
          onClick={() => {
            const form = document.getElementById(
              formId,
            ) as HTMLFormElement | null;
            form?.requestSubmit();
          }}
        >
          {confirmLabel}
        </s-button>
        <s-button slot="secondary-actions" command="--hide" commandFor={id}>
          Cancel
        </s-button>
      </s-modal>
    </>
  );
}
