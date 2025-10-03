export function showError(message, context = 'alert') {
  switch (context) {
    case 'alert':
      alert(message || 'An error occurred.');
      break;
    case 'console':
      console.error(message || 'An error occurred.');
      break;
    case 'status':
      // For options page - would need to be implemented
      console.error('Status error:', message);
      break;
    case 'popup':
      // For popup - would need to be implemented
      console.error('Popup error:', message);
      break;
    default:
      console.error(message || 'An error occurred.');
  }
}

export function handleApiError(error, fallbackMessage = 'Operation failed') {
  const message = error?.message || fallbackMessage;
  showError(message);
}

export function handleUserError(error, fallbackMessage = 'Something went wrong') {
  const message = error?.message || fallbackMessage;
  showError(message);
}