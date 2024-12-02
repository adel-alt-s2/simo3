import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useData } from '../../contexts/DataContext';
import { useAppointments } from '../../contexts/AppointmentContext';
import { formatters } from '../../utils/formatters';
import ValidationModal from './ValidationModal';
import DeleteConfirmationModal from './DeleteConfirmationModal';
import { PatientNumberService } from '../../services/patient/PatientNumberService';

interface ConsultationTableProps {
  visits: Array<{
    id: string;
    time: string;
    patient: string;
    nom?: string;
    prenom?: string;
    patientId?: string;
    amount: string;
    paid: boolean;
    paymentMethod: string;
    isDelegue: boolean;
    isGratuite: boolean;
    isNewPatient: boolean;
    isCanceled: boolean;
    ficheNumber?: string;
    status?: string;
    numeroPatient?: string;
    telephone?: string;
  }>;
  selectedDate: Date;
  dateRange: { start: Date; end: Date };
  onDateSelect: (date: Date) => void;
  onRangeSelect: (range: { start: Date; end: Date } | null) => void;
}

export default function ConsultationTable({ 
  visits, 
  selectedDate, 
  dateRange, 
  onDateSelect, 
  onRangeSelect 
}: ConsultationTableProps) {
  const { patients, addPatient, updatePatient } = useData();
  const { updateAppointment, deleteAppointment } = useAppointments();
  const [editingVisit, setEditingVisit] = useState<string | null>(null);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [validationMessage, setValidationMessage] = useState('');
  const [editValues, setEditValues] = useState<{
    [key: string]: {
      status: string;
      ficheNumber: string;
      numeroPatient?: string;
    };
  }>({});

  const validateFicheNumber = (number: string): boolean => {
    if (!number) return true;
    const pattern = /^F\d{2}-\d{4}$/i;
    return pattern.test(number);
  };

  const formatFicheNumber = (number: string): string => {
    if (!number) return '';
    
    const cleaned = number.replace(/[^\d-]/g, '');
    const parts = cleaned.split('-');
    
    if (parts.length === 2) {
      const [part1, part2] = parts;
      return `F${part1.padStart(2, '0')}-${part2.padStart(4, '0')}`;
    }
    
    return number;
  };

  const handleEdit = (visitId: string) => {
    const visit = visits.find(v => v.id === visitId);
    if (visit) {
      const patient = patients.find(p => p.id === visit.patientId);
      setEditingVisit(visitId);
      setEditValues({
        [visitId]: {
          status: visit.status || '-',
          ficheNumber: visit.ficheNumber || '',
          numeroPatient: patient?.numeroPatient || visit.numeroPatient || ''
        }
      });
    }
  };

  const handleDelete = (visitId: string) => {
    setSelectedVisitId(visitId);
    setShowDeleteModal(true);
  };

  const confirmDelete = () => {
    if (selectedVisitId) {
      const visit = visits.find(v => v.id === selectedVisitId);
      if (visit) {
        // Si c'était un nouveau patient avec un numéro réservé, on libère le numéro
        if (!visit.patientId && visit.numeroPatient) {
          PatientNumberService.releaseNumber(visit.numeroPatient, patients);
        }

        // Supprimer le rendez-vous
        deleteAppointment(selectedVisitId);

        // Supprimer tous les rendez-vous associés au même patient et à la même date
        if (visit.patientId) {
          const samePatientVisits = visits.filter(v => 
            v.patientId === visit.patientId && 
            format(parseISO(v.time), 'yyyy-MM-dd') === format(parseISO(visit.time), 'yyyy-MM-dd')
          );
          samePatientVisits.forEach(v => {
            if (v.id !== selectedVisitId) {
              deleteAppointment(v.id);
            }
          });
        }
      }
      setShowDeleteModal(false);
      setSelectedVisitId(null);
    }
  };

  const handleSave = async (visitId: string) => {
    const editValue = editValues[visitId];
    const visit = visits.find(v => v.id === visitId);
    
    if (editValue && visit) {
      if (editValue.status === 'Validé') {
        // Vérification du numéro de fiche
        if (!editValue.ficheNumber) {
          setValidationMessage('Le numéro de fiche patient est obligatoire pour un rendez-vous validé.');
          setShowValidationModal(true);
          return;
        }

        const formattedFicheNumber = formatFicheNumber(editValue.ficheNumber);
        if (!validateFicheNumber(formattedFicheNumber)) {
          setValidationMessage('Le numéro de fiche doit être au format FXX-XXXX');
          setShowValidationModal(true);
          return;
        }

        const ficheExists = visits.some(v => 
          v.id !== visitId && 
          v.ficheNumber === formattedFicheNumber
        );

        if (ficheExists) {
          setValidationMessage('Ce numéro de fiche existe déjà pour un autre patient');
          setShowValidationModal(true);
          return;
        }

        // Gestion du numéro de patient
        let numeroPatient = editValue.numeroPatient;
        const existingPatient = patients.find(p => p.id === visit.patientId);

        if (!numeroPatient) {
          if (existingPatient) {
            numeroPatient = existingPatient.numeroPatient;
          } else {
            numeroPatient = PatientNumberService.getNextPatientNumber();
            PatientNumberService.reserveNumber(numeroPatient);
          }
        }

        // Mise à jour ou création du patient
        if (visit.patientId && existingPatient) {
          updatePatient(visit.patientId, {
            ...existingPatient,
            numeroPatient
          });
        } else if (visit.nom && visit.prenom) {
          const newPatient = {
            id: crypto.randomUUID(),
            numeroPatient,
            nom: visit.nom,
            prenom: visit.prenom,
            telephone: visit.telephone || '',
            ville: '',
            cin: '',
            dateNaissance: '',
            antecedents: []
          };
          addPatient(newPatient);
          visit.patientId = newPatient.id;
        }

        // Mise à jour du rendez-vous
        updateAppointment(visitId, {
          ...visit,
          status: editValue.status,
          ficheNumber: formattedFicheNumber,
          numeroPatient
        });
      } else {
        // Si le statut n'est pas "Validé", on supprime le numéro de fiche et le numéro de patient
        // sauf si c'est un patient existant
        const existingPatient = patients.find(p => p.id === visit.patientId);
        const updatedVisit = {
          ...visit,
          status: editValue.status,
          ficheNumber: '',
          numeroPatient: existingPatient?.numeroPatient || undefined
        };

        // Si c'était un nouveau patient avec un numéro réservé, on libère le numéro
        if (!existingPatient && visit.numeroPatient) {
          PatientNumberService.releaseNumber(visit.numeroPatient, patients);
        }

        updateAppointment(visitId, updatedVisit);
      }
      
      setEditingVisit(null);
    }
  };

  const getStatusColor = (status: string | undefined): string => {
    switch (status) {
      case 'Validé':
        return 'bg-green-500 text-white';
      case 'Annulé':
        return 'bg-red-500 text-white';
      case 'Reporté':
        return 'bg-yellow-500 text-white';
      case 'Absent':
        return 'bg-gray-500 text-white';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPatientFiches = (patientId: string | undefined) => {
    if (!patientId) return '';
    
    return visits
      .filter(v => v.patientId === patientId && v.ficheNumber)
      .map(v => v.ficheNumber)
      .filter((f, i, arr) => arr.indexOf(f) === i)
      .join(' / ');
  };

  const getPatientDisplayName = (visit: ConsultationTableProps['visits'][0]) => {
    if (visit.patientId) {
      const patient = patients.find(p => p.id === visit.patientId);
      if (patient) {
        return formatters.patientName(patient.nom, patient.prenom);
      }
    }
    
    if (visit.nom && visit.prenom) {
      return formatters.patientName(visit.nom, visit.prenom);
    }
    
    return visit.patient || '-';
  };

  return (
    <>
      <div className="bg-white shadow rounded-lg">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  N° Patient
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Patient
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Heure
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Ancien Patient
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Ancien N° fiche Patient
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  N° fiche Patient
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Confirmation rendez-vous
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Montant
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {visits.map((visit) => {
                const isEditing = editingVisit === visit.id;
                const editValue = editValues[visit.id] || {
                  status: visit.status || '-',
                  ficheNumber: visit.ficheNumber || '',
                  numeroPatient: visit.numeroPatient || ''
                };
                const patient = patients.find(p => p.id === visit.patientId);
                const isNewPatient = !patient;
                const previousFiches = getPatientFiches(visit.patientId);

                return (
                  <tr key={`visit-${visit.id}`} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {isEditing && editValue.status === 'Validé' ? (
                        <input
                          type="text"
                          value={editValue.numeroPatient || ''}
                          onChange={(e) => setEditValues({
                            ...editValues,
                            [visit.id]: { ...editValue, numeroPatient: e.target.value }
                          })}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          placeholder="P0000"
                          required
                          readOnly={!isNewPatient}
                        />
                      ) : (
                        formatters.patientNumber(patient?.numeroPatient || visit.numeroPatient)
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {getPatientDisplayName(visit)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {format(parseISO(visit.time), 'HH:mm')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {isNewPatient ? 'Non' : 'Oui'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {previousFiches || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {isEditing && editValue.status === 'Validé' ? (
                        <input
                          type="text"
                          value={editValue.ficheNumber}
                          onChange={(e) => setEditValues({
                            ...editValues,
                            [visit.id]: { ...editValue, ficheNumber: e.target.value }
                          })}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          placeholder="FXX-XXXX"
                          required
                        />
                      ) : (
                        visit.ficheNumber || '-'
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditing ? (
                        <select
                          value={editValue.status}
                          onChange={(e) => setEditValues({
                            ...editValues,
                            [visit.id]: { 
                              ...editValue, 
                              status: e.target.value,
                              ficheNumber: e.target.value === 'Validé' ? editValue.ficheNumber : ''
                            }
                          })}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                        >
                          <option value="-">-</option>
                          <option value="Validé">Validé</option>
                          <option value="Annulé">Annulé</option>
                          <option value="Reporté">Reporté</option>
                          <option value="Absent">Absent</option>
                        </select>
                      ) : (
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(visit.status)}`}>
                          {visit.status || '-'}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {visit.amount ? formatters.amount(visit.amount) : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex space-x-2">
                        {isEditing ? (
                          <button
                            onClick={() => handleSave(visit.id)}
                            className="text-indigo-600 hover:text-indigo-900"
                          >
                            Enregistrer
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => handleEdit(visit.id)}
                              className="text-indigo-600 hover:text-indigo-900"
                            >
                              Modifier
                            </button>
                            <button
                              onClick={() => handleDelete(visit.id)}
                              className="text-red-600 hover:text-red-900"
                            >
                              Supprimer
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ValidationModal
        isOpen={showValidationModal}
        onClose={() => setShowValidationModal(false)}
        message={validationMessage}
      />

      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedVisitId(null);
        }}
        onConfirm={confirmDelete}
        message="Cette action supprimera également tous les rendez-vous associés à ce patient pour la même date. Êtes-vous sûr de vouloir continuer ?"
      />
    </>
  );
}