import SubmitEventForm from '@/components/SubmitEventForm';

export default function SubmitPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold mb-4 text-gray-900 dark:text-white">
          Submit an Event
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          Share an upcoming AdTech or media event with the community.
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
          All submissions are pending approval before appearing on the calendar.
        </p>
        <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg max-w-2xl mx-auto">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <strong>Login to submit events, subscribe to The Media Calendar, add events to your calendar and customize your event feeds.</strong>
          </p>
        </div>
      </div>

      <SubmitEventForm />
    </div>
  );
}
