import { useState } from "react";

/**
 * A setting that is hard to get back (this device's session, the other devices'): the first tap
 * asks in place, Cancelar or the action; the app asks the same in a dialog (ConfirmAction).
 */
export const ConfirmSetting = ({
  action,
  question,
  detail,
  confirm,
  disabled = false,
  onConfirm,
}: {
  action: string;
  question: string;
  detail: string;
  confirm: string;
  disabled?: boolean;
  onConfirm: () => void;
}) => {
  const [asking, setAsking] = useState(false);
  return asking ? (
    <div className="setting">
      <span className="label" role="status">
        {question}
        <span className="sub">{detail}</span>
      </span>
      <span className="confirm">
        <button type="button" className="ghost small" onClick={() => setAsking(false)}>
          Cancelar
        </button>
        <button
          type="button"
          className="ghost small danger"
          disabled={disabled}
          onClick={onConfirm}
        >
          {confirm}
        </button>
      </span>
    </div>
  ) : (
    <button
      type="button"
      className="setting danger"
      disabled={disabled}
      onClick={() => setAsking(true)}
    >
      {action}
    </button>
  );
};
