interface ConfirmDestructiveModalProps {
  id: string;
  heading: string;
  message: string;
  confirmLabel: string;
  triggerLabel: string;
  /** id of a <form> elsewhere on the page that the confirm button submits. */
  formId?: string;
  triggerVariant?: "primary" | "secondary" | "tertiary";
  triggerIcon?: string;
  triggerAccessibilityLabel?: string;
  disabled?: boolean;
}

// Polaris web components expose modal show/hide via the platform's
// command/commandFor invoker pattern (a <s-button command="--show"
// commandFor="my-modal"> opens <s-modal id="my-modal">) rather than React
// state, so this needs no open/close logic of its own.
export function ConfirmDestructiveModal({
  id,
  heading,
  message,
  confirmLabel,
  triggerLabel,
  formId,
  triggerVariant = "secondary",
  triggerIcon,
  triggerAccessibilityLabel,
  disabled = false,
}: ConfirmDestructiveModalProps) {
  return (
    <>
      <s-button
        command="--show"
        commandFor={id}
        variant={triggerVariant}
        tone="critical"
        disabled={disabled}
        {...(triggerIcon ? { icon: triggerIcon as never } : {})}
        {...(triggerAccessibilityLabel ? { accessibilityLabel: triggerAccessibilityLabel } : {})}
      >
        {triggerLabel}
      </s-button>
      <s-modal id={id} heading={heading}>
        <s-paragraph>{message}</s-paragraph>
        <s-button
          slot="primary-action"
          command="--hide"
          commandFor={id}
          tone="critical"
          type={formId ? "submit" : "button"}
          {...(formId ? { form: formId } : {})}
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
