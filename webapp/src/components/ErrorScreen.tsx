/**
 * Error Screen Component
 */

import styles from './ErrorScreen.module.css';

interface ErrorScreenProps {
  title: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function ErrorScreen({ title, message, action }: ErrorScreenProps) {
  return (
    <div className={styles.container}>
      <div className={styles.icon}>⚠️</div>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.message}>{message}</p>
      {action && (
        <button className={styles.button} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
